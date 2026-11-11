import { message } from '../shared/messages';
import { sameRepository } from '../shared/code-hosting';
import { bracketedPaste, dispatchRequestSchema, type DispatchLocation, type DispatchRecord, type DispatchRecordView, type DispatchRequest } from '../shared/dispatch';
import { instructionText, workflowCatalog, type Delivery, type WorkflowSettings } from '../shared/workflows';
import type { AgentType, Panel, PanelCreation, Project } from '../shared/model';
import { platforms } from './code-hosting/platforms';
import type { RunSupervision } from './run-supervision';
import type { ProjectStore } from './storage';

/** What dispatching needs from the Workbench: its projects with their panels, and its change and error reporting. */
export interface DispatchHost {
  projects(): Project[];
  /** The project's ephemeral panels. */
  tray(projectId: string): Panel[];
  workflows(): WorkflowSettings;
  /** Adds a panel of the Agent type to the project's tray and starts it with these arguments after its Agent settings,
   * as adding a panel does. Called within a Workbench operation. */
  addPanel(projectId: string, agent: AgentType, args: string[]): Promise<PanelCreation>;
  changed(): void;
  report(message: string): void;
}

/** A dispatch to a new panel whose first session is not known yet. */
interface PendingDispatch { projectId: string; panelId: string; record: Omit<DispatchRecord, 'session'> }

/**
 * Dispatch: turns an instruction for an issue into text in a panel's terminal, and keeps the append-only Dispatch
 * Records. A record points to the session that took the dispatch, never to a panel; views locate the panel now on
 * that session through Run Supervision (ADR 0003).
 */
export class Dispatches {
  private records: Map<string, DispatchRecord[]>;
  /** Shown on their new panel until it reports a session; never stored. */
  private pending = new Set<PendingDispatch>();
  /** `records` are each project's Dispatch Records as stored, in the order they were written. */
  constructor(records: Record<string, DispatchRecord[]>, private store: ProjectStore, private supervision: RunSupervision, private host: DispatchHost) {
    this.records = new Map(Object.entries(records));
  }

  /** The project's records for its bound repository, newest first, each with the panel now on its session,
   * and its pending dispatches with their new panel. */
  views(project: Project): DispatchRecordView[] {
    const view = ({ issue, time, agent, text }: Omit<DispatchRecord, 'session'>, location: DispatchLocation | null) => ({ issue, time, agent, text, location });
    const bound = (record: Omit<DispatchRecord, 'session'>) => sameRepository(record.repository, project.repository);
    const records = (this.records.get(project.id) ?? []).filter(bound).map(record => view(record, this.locate(record.session)));
    const pending = [...this.pending].filter(pending => pending.projectId === project.id && bound(pending.record))
      .map(({ panelId, record }) => view(record, this.panelLocation(project, panelId)));
    // Written in order, so reversing before the stable sort keeps the later of two equal times first.
    return [...records, ...pending].reverse().sort((a, b) => b.time.localeCompare(a.time));
  }

  /** Forgets a deleted project's records; the store deletes them with the project. */
  forget(projectId: string) {
    this.records.delete(projectId);
    for (const pending of this.pending) if (pending.projectId === projectId) this.pending.delete(pending);
  }

  /**
   * Delivers an instruction of an enabled workflow for an issue of the bound repository, in the target Agent type's
   * spelling, submitting it when the instruction's delivery (inverted on request) says so. An existing panel gets it
   * pasted regardless of its state or draft, and the record is written on the session the panel is on at that moment.
   * A new panel joins the tray; see `dispatchToNewPanel`. Resolves with the new panel, or null for an existing one.
   */
  async dispatch(projectId: string, request: DispatchRequest): Promise<PanelCreation | null> {
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
    const configured = setting.instructions[instruction.id]?.delivery ?? 'submit';
    const delivery: Delivery = invert ? (configured === 'submit' ? 'fill' : 'submit') : configured;
    const url = platforms[repository.platform].issueUrl(repository.path, issue.number);
    const dispatched = (agent: AgentType) => ({ repository, issue: issue.number, time: new Date().toISOString(), agent,
      text: instructionText(agent, instruction, { url, number: issue.number, title: issue.title }) });
    if ('agent' in target) return this.dispatchToNewPanel(projectId, dispatched(target.agent), delivery);
    const panel = [...project.panels, ...this.host.tray(projectId)].find(panel => panel.id === target.panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const run = this.supervision.panelView(panel).run;
    if (run?.state !== 'running') throw new Error(message('dispatchTargetStopped'));
    const record = dispatched(panel.agent);
    await this.supervision.input(run.id, bracketedPaste(record.text, delivery));
    let written: Promise<void> | undefined;
    this.supervision.holdDispatch(run.id, session => { written = this.write(projectId, { ...record, session }); }, () => {});
    await written;
    return null;
  }

  /**
   * Adds a panel of the Agent type to the tray. A submitted instruction is its launch argument; a filled one is pasted,
   * without a return, when the panel first reports Ready. Until the panel reports its first session the dispatch shows
   * on that panel; then its record is written. If the run ends before that, nothing is kept (ADR 0003).
   */
  private async dispatchToNewPanel(projectId: string, record: Omit<DispatchRecord, 'session'>, delivery: Delivery) {
    const creation = await this.host.addPanel(projectId, record.agent, delivery === 'submit' ? [record.text] : []);
    const { run } = creation.launch;
    const pending: PendingDispatch = { projectId, panelId: creation.panel.id, record };
    this.pending.add(pending);
    this.supervision.holdDispatch(run.id,
      session => { void this.write(projectId, { ...record, session }, () => this.pending.delete(pending)); },
      () => { if (this.pending.delete(pending)) this.host.changed(); });
    if (delivery === 'fill') this.supervision.awaitReady(run.id, () => {
      this.supervision.input(run.id, bracketedPaste(record.text, 'fill')).catch(error => this.host.report((error as Error).message));
    });
    return creation;
  }

  /** Appends the record; the text is already delivered, so a failure to store it is reported, not thrown.
   * `settled` runs once the record is stored or has failed, before the change is published. */
  private async write(projectId: string, record: DispatchRecord, settled = () => {}) {
    try {
      await this.store.recordDispatch(projectId, record);
      if (this.host.projects().some(project => project.id === projectId)) this.records.set(projectId, [...this.records.get(projectId) ?? [], record]);
    } catch (error) { this.host.report((error as Error).message); }
    settled();
    this.host.changed();
  }

  /** The panel currently on the session, with what it displays. */
  private locate(session: string): DispatchLocation | null {
    const found = this.supervision.locate(session);
    const project = found && this.host.projects().find(project => project.id === found.projectId);
    return found && project ? this.panelLocation(project, found.panelId) : null;
  }

  /** The project's panel with what it displays, while it has a run. */
  private panelLocation(project: Project, panelId: string): DispatchLocation | null {
    const ephemeral = this.host.tray(project.id).find(panel => panel.id === panelId);
    const panel = ephemeral ?? project.panels.find(panel => panel.id === panelId);
    const view = panel && this.supervision.panelView(panel);
    if (!view?.run) return null;
    return { projectId: project.id, panelId: view.id, runId: view.run.id, ephemeral: !!ephemeral,
      ...(view.status ? { status: view.status } : {}), ...(view.run.title ? { title: view.run.title } : {}) };
  }
}
