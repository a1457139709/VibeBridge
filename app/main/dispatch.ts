import { message } from '../shared/messages';
import { sameRepository, type RepositoryReference } from '../shared/forge';
import { dispatchRequestSchema, type DispatchLocation, type DispatchRecordView, type DispatchRequest } from '../shared/dispatch';
import { commandDelivery, commandText, workflowCommand, type Delivery, type WorkflowId, type WorkflowSettings } from '../shared/workflows';
import { liveRun, projectPanels, type AgentType, type ProjectView, type Run } from '../shared/model';
import type { RunSupervision, PanelLocation } from './run-supervision';
import type { HandOver } from './processing-status';
import type { ProjectStore } from './storage';
import { forges } from './forge/forges';

/** A Dispatch Record as stored: append-only, pointing at the session that took the dispatch, never at a panel
 * (docs/adr/0003-dispatch-records-point-to-sessions.md). */
export interface DispatchRecord {
  projectId: string; repository: RepositoryReference; issue: number;
  /** ISO 8601. */
  dispatchedAt: string;
  agent: AgentType; text: string; sessionId: string;
}

/** Bracketed paste: the CLI takes the text as typed into its input, without acting on line breaks inside it. */
const bracketedPaste = (text: string) => `\x1b[200~${text}\x1b[201~`;

/** Dispatch: turns a request into the text the target's Agent type expects, writes it into the target's terminal
 * through Run Supervision, and keeps the Dispatch Records. Nothing checks what the target is doing or whether the skill
 * is installed. The run's session is held before writing; the record is written once the text is in, on that session, or
 * when the run reports its first session if it has none yet. A run that can no longer hand over a session is not written to. */
export class Dispatches {
  constructor(private records: DispatchRecord[], private store: ProjectStore, private supervision: RunSupervision,
    private changed: () => void, private report: (message: string) => void) {}

  /** Adds to each project its records for its bound repository, oldest first, each with the panel on its session now:
   * that panel may be in any project, and shows its processing state and session title. */
  withViews(projects: Omit<ProjectView, 'dispatches'>[]): ProjectView[] {
    const where = ({ projectId, panelId }: PanelLocation): DispatchLocation | undefined => {
      const project = projects.find(project => project.id === projectId);
      const panel = project && projectPanels(project).find(panel => panel.id === panelId);
      return panel && { projectId, panelId, ...panel.status ? { status: panel.status } : {}, ...panel.run?.title ? { title: panel.run.title } : {} };
    };
    const views = (project: Omit<ProjectView, 'dispatches'>): DispatchRecordView[] => this.records
      .filter(record => record.projectId === project.id && sameRepository(record.repository, project.repository)).map(record => {
        const location = this.supervision.locate(record.sessionId);
        return { issue: record.issue, dispatchedAt: record.dispatchedAt, agent: record.agent, text: record.text, location: (location && where(location)) ?? null };
      });
    return projects.map(project => ({ ...project, dispatches: views(project) }));
  }

  /** Dispatches to a panel with a run: pastes the command after whatever its input holds, then presses Enter to submit. */
  async toPanel(projectId: string, repository: RepositoryReference, panel: { id: string; agent: AgentType; run?: Run },
    request: DispatchRequest, workflows: Record<WorkflowId, WorkflowSettings>) {
    const { issue, workflowId, commandId, invert } = dispatchRequestSchema.parse(request);
    const found = workflowCommand(workflowId, commandId);
    const settings = found && workflows[found.workflow.id];
    if (!found || !settings?.enabled) throw new Error(message('dispatchCommandUnavailable'));
    const run = panel.run;
    if (!run || !liveRun(run)) throw new Error(message('dispatchTargetUnavailable'));
    const configured = commandDelivery(workflows, workflowId, commandId);
    const delivery: Delivery = invert ? (configured === 'submit' ? 'fill' : 'submit') : configured;
    const text = commandText(panel.agent, found.command, { url: forges[repository.forge].issueUrl(repository.path, issue.number), ...issue });
    // The session is taken before writing, so a session switch during the write leaves the record on the one written to.
    let session: string | undefined;
    let handOver: HandOver = sessionId => { session = sessionId; };
    if (!this.supervision.holdDispatch(run.id, sessionId => handOver(sessionId))) throw new Error(message('dispatchTargetUnavailable'));
    await this.supervision.input(run.id, bracketedPaste(text));
    if (delivery === 'submit') await this.supervision.input(run.id, '\r');
    const dispatchedAt = new Date().toISOString();
    const record = (sessionId: string) => this.append({ projectId, repository, issue: issue.number, dispatchedAt, agent: panel.agent, text, sessionId });
    if (session) await record(session);
    else handOver = sessionId => void record(sessionId);
    return { delivery };
  }

  private async append(record: DispatchRecord) {
    try { await this.store.dispatch(record); }
    catch (error) { this.report((error as Error).message); return; }
    this.records.push(record);
    this.changed();
  }

  /** Drops a deleted project's records from memory; the store deletes them with the project. */
  forget(projectId: string) { this.records = this.records.filter(record => record.projectId !== projectId); }
}
