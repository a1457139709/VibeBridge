import { message } from '../shared/messages';
import { sameRepository } from '../shared/code-hosting';
import { bracketedPaste, dispatchRequestSchema, type DispatchLocation, type DispatchRecord, type DispatchRecordView, type DispatchRequest } from '../shared/dispatch';
import { instructionText, workflowCatalog, type WorkflowSettings } from '../shared/workflows';
import type { Panel, Project } from '../shared/model';
import { platforms } from './code-hosting/platforms';
import type { RunSupervision } from './run-supervision';
import type { ProjectStore } from './storage';

/** What dispatching needs from the Workbench: its projects with their panels, and its change and error reporting. */
export interface DispatchHost {
  projects(): Project[];
  /** The project's ephemeral panels. */
  tray(projectId: string): Panel[];
  workflows(): WorkflowSettings;
  changed(): void;
  report(message: string): void;
}

/**
 * Dispatch: turns an instruction for an issue into text in a panel's terminal, and keeps the append-only Dispatch
 * Records. A record points to the session that took the dispatch, never to a panel; views locate the panel now on
 * that session through Run Supervision (ADR 0003).
 */
export class Dispatches {
  private records: Map<string, DispatchRecord[]>;
  /** `records` are each project's Dispatch Records as stored, in the order they were written. */
  constructor(records: Record<string, DispatchRecord[]>, private store: ProjectStore, private supervision: RunSupervision, private host: DispatchHost) {
    this.records = new Map(Object.entries(records));
  }

  /** The project's records for its bound repository, newest first, each with the panel now on its session. */
  views(project: Project): DispatchRecordView[] {
    return (this.records.get(project.id) ?? []).filter(record => sameRepository(record.repository, project.repository)).reverse()
      .map(({ issue, time, agent, text, session }) => ({ issue, time, agent, text, location: this.locate(session) }));
  }

  /** Forgets a deleted project's records; the store deletes them with the project. */
  forget(projectId: string) { this.records.delete(projectId); }

  /**
   * Pastes an instruction of an enabled workflow for an issue of the bound repository into a panel of the project,
   * in the panel's Agent type's spelling and regardless of its state or draft, submitting it when the instruction's
   * delivery (inverted on request) says so. The record is written on the session the panel is on at that moment,
   * or on the first one it reports.
   */
  async dispatch(projectId: string, request: DispatchRequest) {
    const parsed = dispatchRequestSchema.safeParse(request);
    if (!parsed.success) throw new Error(message('dispatchInvalid'));
    const { issue, target, invert } = parsed.data;
    const project = this.host.projects().find(project => project.id === projectId);
    if (!project) throw new Error(message('projectMissing'));
    const repository = project.repository;
    if (!repository) throw new Error(message('repositoryUnbound'));
    const workflow = workflowCatalog.find(workflow => workflow.id === parsed.data.workflow);
    const setting = workflow && this.host.workflows()[workflow.id];
    const instruction = workflow?.instructions.find(instruction => instruction.id === parsed.data.instruction);
    if (!setting?.enabled || !instruction) throw new Error(message('instructionUnavailable'));
    const panel = [...project.panels, ...this.host.tray(projectId)].find(panel => panel.id === target.panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const run = this.supervision.panelView(panel).run;
    if (run?.state !== 'running') throw new Error(message('dispatchTargetStopped'));
    const delivery = setting.instructions[instruction.id]?.delivery ?? 'submit';
    const url = platforms[repository.platform].issueUrl(repository.path, issue.number);
    const text = instructionText(panel.agent, instruction, { url, number: issue.number, title: issue.title });
    await this.supervision.input(run.id, bracketedPaste(text, invert ? (delivery === 'submit' ? 'fill' : 'submit') : delivery));
    const record = { repository, issue: issue.number, time: new Date().toISOString(), agent: panel.agent, text };
    let written: Promise<void> | undefined;
    this.supervision.holdDispatch(run.id, session => { written = this.write(projectId, { ...record, session }); });
    await written;
  }

  /** Appends the record; the text is already delivered, so a failure to store it is reported, not thrown. */
  private async write(projectId: string, record: DispatchRecord) {
    try {
      await this.store.recordDispatch(projectId, record);
      if (!this.host.projects().some(project => project.id === projectId)) return;
      this.records.set(projectId, [...this.records.get(projectId) ?? [], record]);
      this.host.changed();
    } catch (error) { this.host.report((error as Error).message); }
  }

  /** The panel currently on the session, with what it displays. */
  private locate(session: string): DispatchLocation | null {
    const found = this.supervision.locate(session);
    const project = found && this.host.projects().find(project => project.id === found.projectId);
    if (!found || !project) return null;
    const ephemeral = this.host.tray(project.id).find(panel => panel.id === found.panelId);
    const panel = ephemeral ?? project.panels.find(panel => panel.id === found.panelId);
    const view = panel && this.supervision.panelView(panel);
    if (!view?.run) return null;
    return { projectId: project.id, panelId: view.id, runId: view.run.id, ephemeral: !!ephemeral,
      ...(view.status ? { status: view.status } : {}), ...(view.run.title ? { title: view.run.title } : {}) };
  }
}
