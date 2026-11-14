import { randomUUID } from 'node:crypto';
import { message, detail } from '../shared/messages';
import { liveRun as live, type AgentCommand, type AgentType, type LaunchResult, type Panel, type PanelView, type Project, type Run, type TerminalEvent, type WorkbenchEvent } from '../shared/model';
import { ProcessingStatus, type HandOver } from './processing-status';
import { sessionTitle } from './session-title';
import { TerminalClient } from './terminal-client';

export type Terminal = Pick<TerminalClient, 'start' | 'checkCommand' | 'input' | 'resize' | 'stop' | 'acknowledgeOutput' | 'shutdown'>;
export type TerminalFactory = (onEvent: (event: TerminalEvent) => void, onFailure: (message: string, stopped?: boolean) => void) => Terminal;

/** Where a panel is: its project and its own ID. */
export interface PanelLocation { projectId: string; panelId: string }

export interface SupervisionCallbacks {
  /** A run, its session title, its processing state or the run list changed. */
  changed(): void;
  /** An accepted terminal event of a current run that subscribers use. */
  emit(event: WorkbenchEvent): void;
  report(message: string): void;
  /** The run ended without the workbench stopping it. This includes the Agent finishing
   * normally, e.g. `/exit` in the CLI, so it signals neither a fault nor a failed task.
   * The run has already left the run list. */
  onRunExited(run: Run): void;
}

/** Run Supervision: owns every Agent run from launch through status observation to exit and
 * cleanup, and the terminal host they run in. It reports outcomes only; panels, layout and
 * projects stay with the Workbench.
 *
 * A launch is confirmed, failed or unconfirmed. An unconfirmed launch (no host response) may
 * still be running, so its later events are accepted. Each run's observation is released on
 * its exit, on host failure, when its panel is released, and on shutdown.
 */
export class RunSupervision {
  private list: Run[] = [];
  private processing: ProcessingStatus;
  private terminal: Terminal;
  private expectedRuns = new Map<string, { runId: string; agent: AgentType }>();
  private controlledStops = new Set<string>();
  private terminalFailure?: string;
  constructor(directory: string, private callbacks: SupervisionCallbacks,
    terminal: TerminalFactory = (onEvent, onFailure) => new TerminalClient(directory, onEvent, onFailure)) {
    this.processing = new ProcessingStatus(() => callbacks.changed(), directory);
    this.terminal = terminal(event => this.terminalEvent(event), (message, stopped) => {
      if (stopped) {
        this.terminalFailure = message;
        for (const run of this.list) if (live(run)) { run.state = 'stopped'; this.processing.forget(run.id); }
        callbacks.changed();
      }
      callbacks.report(message);
    });
  }
  /** The panel with its current run, of any state, and the processing state that run displays. */
  panelView(panel: Panel): PanelView {
    const run = this.list.find(run => run.panelId === panel.id);
    if (!run) return { ...panel };
    const status = this.processing.status(run);
    return status ? { ...panel, run, status } : { ...panel, run };
  }
  /** The panel whose run is on this session now, if any. */
  locate(sessionId: string): PanelLocation | undefined {
    const run = this.list.find(run => this.current(run) && this.processing.session(run.id) === sessionId);
    return run && { projectId: run.projectId, panelId: run.panelId };
  }
  /** Holds a pending dispatch on a current run until it reports its first session ID, then hands
   * that ID over; at once if the run is already on a session. The hold is dropped, unpersisted,
   * when the run ends first. False when the run can no longer report a session.
   */
  holdDispatch(runId: string, handOver: HandOver) {
    const run = this.list.find(run => run.id === runId);
    return !!run && this.current(run) && this.processing.holdDispatch(runId, handOver);
  }
  /** A live run its panel still expects. */
  private current(run: Run) { return live(run) && this.expects(run); }
  /** Whether this run is still the one its panel expects. */
  expects(run: Run) { return this.expectedRuns.get(run.panelId)?.runId === run.id; }
  private terminalEvent(event: TerminalEvent) {
    if (event.kind === 'started') {
      if (!this.expects(event.run)) return;
      this.processing.lifecycle(event.run);
      this.list = this.list.filter(run => run.panelId !== event.run.panelId).concat(event.run);
      this.callbacks.changed();
    } else {
      const run = this.list.find(run => run.id === event.runId);
      if (!run || run.state !== 'running' || !this.expects(run)) return;
      if (event.kind === 'stopping') { this.processing.stopping(run.id); return; }
      if (event.kind === 'title') {
        // Agents animate a spinner in the terminal title while busy; only a new session title is a change.
        const title = sessionTitle(this.expectedRuns.get(run.panelId)!.agent, event.title);
        if (title === run.title) return;
        if (title) run.title = title; else delete run.title;
        this.callbacks.changed();
        return;
      }
      if (event.kind === 'exit') {
        this.processing.forget(run.id);
        const controlled = this.controlledStops.delete(run.id);
        if (controlled) run.state = 'stopped';
        else this.list = this.list.filter(r => r.id !== run.id);
        if (!controlled) this.callbacks.onRunExited(run);
        this.callbacks.changed();
      }
    }
    this.callbacks.emit(event);
  }
  async start(project: Project, panel: Panel, command: AgentCommand): Promise<LaunchResult> {
    const id = randomUUID();
    this.expectedRuns.set(panel.id, { runId: id, agent: panel.agent });
    try {
      const launch = await this.processing.prepare(id, panel.agent, command, project.directory);
      const run = await this.terminal.start({ id, panelId: panel.id, projectId: project.id, directory: project.directory, ...launch });
      return { outcome: run.state === 'failed' ? 'failed' : 'started', run, agent: panel.agent };
    } catch (error) {
      // A missing response is not proof that the process never started. Preserve any
      // observed run and keep accepting its later events instead of retrying implicitly.
      // A failed terminal host has already stopped everything it ran and reports nothing more.
      const observed = this.list.find(run => run.id === id);
      const run = observed ?? { id, panelId: panel.id, projectId: project.id, state: this.terminalFailure ? 'stopped' as const : 'starting' as const };
      if (!observed) this.terminalEvent({ kind: 'started', run });
      return { outcome: 'unconfirmed', run: structuredClone(run), agent: panel.agent, reason: message('launchUnconfirmed', { reason: detail((error as Error).message) }) };
    }
  }
  /** Stops the runs of these panels; returns one reason per run that could not be stopped,
   * numbering panels by their position in the given list. */
  async stopPanels(panels: Panel[]): Promise<string[]> {
    const ids = panels.map(panel => panel.id);
    if (this.terminalFailure && this.list.some(run => ids.includes(run.panelId))) return [this.terminalFailure];
    const failures: string[] = [];
    for (const run of this.list.filter(run => ids.includes(run.panelId) && live(run))) {
      // Mark before requesting cleanup: its exit event can arrive before the response.
      this.controlledStops.add(run.id);
      try { await this.terminal.stop(run.id); }
      catch (error) { failures.push(message('panelFailure', { number: ids.indexOf(run.panelId) + 1, reason: detail((error as Error).message) })); }
    }
    return failures;
  }
  /** Stops the panel's live run as a controlled stop. If the stop fails, a later exit
   * counts as the run ending on its own again. */
  async stopPanel(panelId: string) {
    const run = this.list.find(r => r.panelId === panelId && live(r));
    if (!run) return;
    this.controlledStops.add(run.id);
    try { await this.terminal.stop(run.id); }
    catch (error) { this.controlledStops.delete(run.id); throw error; }
  }
  /** Forgets runs of panels that no longer exist; their late events are ignored. */
  release(panelIds: string[]) {
    for (const id of panelIds) this.expectedRuns.delete(id);
    for (const run of this.list) if (panelIds.includes(run.panelId)) this.processing.forget(run.id);
    this.list = this.list.filter(r => !panelIds.includes(r.panelId));
  }
  input(runId: string, data: string) { return this.terminal.input(runId, data); }
  resize(runId: string, cols: number, rows: number) { return this.terminal.resize(runId, cols, rows); }
  acknowledgeOutput(runId: string, characters: number) { this.terminal.acknowledgeOutput(runId, characters); }
  checkCommand(command: string) { return this.terminal.checkCommand(command); }
  /** Ends all runs, then observation; reports the first failure after attempting both. */
  async shutdown() {
    let error: unknown;
    try { await this.terminal.shutdown(); } catch (failure) { error = failure; }
    try { await this.processing.close(); } catch (failure) { error ??= failure; }
    if (error) throw error;
  }
}
