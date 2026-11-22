import { message } from '../shared/messages';
import { sameRepository, type RepositoryReference } from '../shared/forge/forge';
import {
  dispatchRequestSchema,
  type DispatchLocation,
  type DispatchRecordView,
  type DispatchRequest,
} from '../shared/dispatch';
import {
  commandDelivery,
  commandText,
  invertedDelivery,
  workflowCommand,
  type Delivery,
  type WorkflowId,
  type WorkflowSettings,
} from '../shared/settings/workflows';
import {
  isLiveRun,
  projectPanels,
  type AgentType,
  type PanelCreation,
  type PanelView,
  type ProjectView,
} from '../shared/model';
import type { RunSupervision, PanelLocation } from './runs/run-supervision';
import type { SessionReceiver } from './runs/processing-status';
import type { ProjectStore } from './persistence/storage';
import { forges } from './forge/forges';
import { errorMessage } from '../shared/error-message';

/** A Dispatch Record as stored: append-only, pointing at the session that took the dispatch, never at a panel
 * (docs/adr/0003-dispatch-records-point-to-sessions.md). */
export interface DispatchRecord {
  projectId: string;
  repository: RepositoryReference;
  issue: number;
  /** ISO 8601. */
  dispatchedAt: string;
  agent: AgentType;
  /** The skill dispatched, as the workflow command names it, without the Agent type's invocation syntax. */
  skill: string;
  /** The full text sent; kept in the store, not shown. */
  text: string;
  sessionId: string;
}

/** Bracketed paste: the CLI takes the text as typed into its input, without acting on line breaks inside it. */
const bracketedPaste = (text: string) => `\x1b[200~${text}\x1b[201~`;

/** The panels a dispatch can go to: the project's panels, and a new ephemeral one that joins its tray and starts its
 * Agent with these arguments after the ones the Agent settings give its type. */
export interface DispatchTargets {
  panel(panelId: string): PanelView | undefined;
  add(agent: AgentType, args: string[]): Promise<PanelCreation>;
}

/** What a dispatch sends, before it is sent. */
type DispatchContent = Omit<DispatchRecord, 'sessionId' | 'dispatchedAt'>;

/** A dispatch sent, not yet attached to a session. */
type UnrecordedDispatch = Omit<DispatchRecord, 'sessionId'>;

const sentNow = (content: DispatchContent): UnrecordedDispatch => ({
  ...content,
  dispatchedAt: new Date().toISOString(),
});

/** A dispatch to a new panel whose run has not reported a session yet: shown on that panel until it does. Never stored. */
interface PendingDispatch {
  panelId: string;
  dispatch: UnrecordedDispatch;
}

/** Dispatch: turns a request into the text the target's Agent type expects, delivers it through Run Supervision, and
 * keeps the Dispatch Records. Nothing checks what the target is doing or whether the skill is installed. The record is
 * written on the session the target's run is on when the text goes in, or on the first one it reports; a run that ends
 * before reporting one leaves no record. */
export class Dispatches {
  private pending: PendingDispatch[] = [];
  constructor(
    private records: DispatchRecord[],
    private store: ProjectStore,
    private supervision: RunSupervision,
    private changed: () => void,
    private report: (message: string) => void,
  ) {}

  /** Adds to each project its dispatches to its bound repository, oldest first, each with the panel on its session now:
   * that panel may be in any project. A dispatch still waiting for its new panel's first session shows that panel. */
  withDispatches(projects: Omit<ProjectView, 'dispatches'>[]): ProjectView[] {
    const where = ({ projectId, panelId }: PanelLocation): DispatchLocation | null => {
      const project = projects.find(project => project.id === projectId);
      const open = project && projectPanels(project).some(panel => panel.id === panelId);
      return open ? { projectId, panelId } : null;
    };
    const view = (
      { issue, dispatchedAt, agent, skill }: UnrecordedDispatch,
      sessionId: string | undefined,
      location: PanelLocation | undefined,
    ): DispatchRecordView => ({
      issueNumber: issue,
      dispatchedAt,
      agent,
      skill,
      ...(sessionId ? { sessionId } : {}),
      location: location ? where(location) : null,
    });
    const views = (project: Omit<ProjectView, 'dispatches'>) =>
      [
        ...this.records.map(record => ({
          record,
          view: () => view(record, record.sessionId, this.supervision.locate(record.sessionId)),
        })),
        ...this.pending.map(({ panelId, dispatch }) => ({
          record: dispatch,
          view: () => view(dispatch, undefined, { projectId: dispatch.projectId, panelId }),
        })),
      ]
        .filter(
          ({ record }) => record.projectId === project.id && sameRepository(record.repository, project.repository),
        )
        .sort((a, b) => a.record.dispatchedAt.localeCompare(b.record.dispatchedAt))
        .map(({ view }) => view());
    return projects.map(project => ({ ...project, dispatches: views(project) }));
  }

  /** Dispatches an issue of the bound repository with a command of an enabled workflow, to a panel with a run or to a
   * new panel. Resolves with the delivery used and the panel that took the dispatch. */
  async dispatch(
    projectId: string,
    repository: RepositoryReference,
    request: DispatchRequest,
    workflows: Record<WorkflowId, WorkflowSettings>,
    targets: DispatchTargets,
  ) {
    const { issue, workflowId, commandId, target, invertDelivery: invert } = dispatchRequestSchema.parse(request);
    const found = workflowCommand(workflowId, commandId);
    const settings = found && workflows[found.workflow.id];
    if (!found || !settings?.enabled) throw new Error(message('dispatchCommandUnavailable'));
    const configured = commandDelivery(workflows, workflowId, commandId);
    const delivery: Delivery = invert ? invertedDelivery(configured) : configured;
    /** The command in the Agent type's syntax, and what its record holds. */
    const dispatchContent = (agent: AgentType): DispatchContent => {
      const text = commandText(agent, found.command, {
        url: forges[repository.forge].issueUrl(repository, issue.number),
        ...issue,
      });
      return {
        projectId,
        repository,
        issue: issue.number,
        agent,
        skill: found.command.skill,
        text,
      };
    };
    const panelId =
      target.kind === 'new'
        ? await this.toNewPanel(dispatchContent(target.agent), delivery, targets)
        : await this.toPanel(target.panelId, dispatchContent, delivery, targets);
    return { delivery, panelId };
  }

  /** A new panel is given the command to submit as a launch argument, or, to fill, starts without it and has it pasted
   * once it first reports ready. It counts as sent when the panel is asked for. The dispatch shows that panel until its
   * run reports a session to record it on. */
  private async toNewPanel(content: DispatchContent, delivery: Delivery, targets: DispatchTargets) {
    const dispatch = sentNow(content);
    const { panel, launch } = await targets.add(dispatch.agent, delivery === 'submit' ? [dispatch.text] : []);
    if (launch.outcome === 'failed') throw new Error(message('launchFailed'));
    if (launch.outcome === 'unconfirmed') this.report(launch.reason);
    const runId = launch.run.id;
    const pending: PendingDispatch = { panelId: panel.id, dispatch };
    this.pending.push(pending);
    const dropPending = () => {
      this.pending = this.pending.filter(item => item !== pending);
    };
    if (
      !this.supervision.awaitFirstSession(
        runId,
        sessionId => void this.append({ ...dispatch, sessionId }, dropPending),
        dropPending,
      )
    )
      dropPending();
    if (delivery === 'fill')
      this.supervision.awaitFirstReady(
        runId,
        () =>
          void this.supervision
            .input(runId, bracketedPaste(dispatch.text))
            .catch(error => this.report(errorMessage(error))),
      );
    this.changed();
    return panel.id;
  }

  /** A panel with a run has the command pasted after whatever its input holds, then Enter submits it. It counts as
   * sent once the write is done. */
  private async toPanel(
    panelId: string,
    dispatchContent: (agent: AgentType) => DispatchContent,
    delivery: Delivery,
    targets: DispatchTargets,
  ) {
    const panel = targets.panel(panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const run = panel.run;
    if (!run || !isLiveRun(run)) throw new Error(message('dispatchTargetUnavailable'));
    // The session is taken before writing, so a session switch during the write leaves the record on the one written to.
    let session: string | undefined;
    let onSessionKnown: SessionReceiver = sessionId => {
      session = sessionId;
    };
    if (!this.supervision.awaitFirstSession(run.id, sessionId => onSessionKnown(sessionId)))
      throw new Error(message('dispatchTargetUnavailable'));
    const content = dispatchContent(panel.agent);
    await this.supervision.input(run.id, bracketedPaste(content.text));
    if (delivery === 'submit') await this.supervision.input(run.id, '\r');
    const written = sentNow(content);
    if (session) await this.append({ ...written, sessionId: session });
    else onSessionKnown = sessionId => void this.append({ ...written, sessionId });
    return panel.id;
  }

  /** Stores a record, then shows it; `onStoreAnswered` runs once the store has answered, either way, before the snapshot changes. */
  private async append(record: DispatchRecord, onStoreAnswered?: () => void) {
    let stored = true;
    try {
      await this.store.appendDispatchRecord(record);
    } catch (error) {
      stored = false;
      this.report(errorMessage(error));
    }
    onStoreAnswered?.();
    if (stored) this.records.push(record);
    this.changed();
  }

  /** Drops a deleted project's records from memory; the store deletes them with the project. */
  forget(projectId: string) {
    this.records = this.records.filter(record => record.projectId !== projectId);
    this.pending = this.pending.filter(({ dispatch }) => dispatch.projectId !== projectId);
  }
}
