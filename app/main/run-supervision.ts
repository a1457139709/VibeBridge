import { randomUUID } from 'node:crypto';
import { message, detail } from '../shared/messages';
import type { AgentCommand, LaunchResult, Panel, Project, Run, TerminalEvent } from '../shared/model';
import type { ProcessingProjection } from '../shared/processing-status';
import { ProcessingStatus } from './processing-status';
import { TerminalClient } from './terminal-client';

export type Terminal = Pick<TerminalClient, 'start' | 'checkCommand' | 'input' | 'resize' | 'stop' | 'acknowledgeOutput' | 'shutdown'>;
export type TerminalFactory = (onEvent: (event: TerminalEvent) => void, onFailure: (message: string, stopped?: boolean) => void) => Terminal;

export interface SupervisionCallbacks {
  /** A run, its processing state or the run list changed. */
  changed(): void;
  /** An accepted terminal event of a current run, for subscribers. */
  emit(event: TerminalEvent): void;
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
  private expectedRuns = new Map<string, string>();
  private controlledStops = new Set<string>();
  private terminalFailure?: string;
  constructor(directory: string, private callbacks: SupervisionCallbacks,
    terminal: TerminalFactory = (onEvent, onFailure) => new TerminalClient(directory, onEvent, onFailure)) {
    this.processing = new ProcessingStatus(() => callbacks.changed(), directory);
    this.terminal = terminal(event => this.terminalEvent(event), (message, stopped) => {
      if (stopped) {
        this.terminalFailure = message;
        for (const run of this.list) if (run.state === 'running' || run.state === 'starting') { run.state = 'stopped'; this.processing.forget(run.id); }
        callbacks.changed();
      }
      callbacks.report(message);
    });
  }
  runs() { return this.list; }
  projection(projects: Project[]): ProcessingProjection { return this.processing.project(projects, this.list); }
  /** Whether this run is still the one its panel expects. */
  expects(run: Run) { return this.expectedRuns.get(run.panelId) === run.id; }
  private terminalEvent(event: TerminalEvent) {
    if (event.kind === 'started') {
      if (this.expectedRuns.get(event.run.panelId) !== event.run.id) return;
      this.processing.lifecycle(event.run);
      this.list = this.list.filter(run => run.panelId !== event.run.panelId).concat(event.run);
      this.callbacks.changed();
    } else {
      const run = this.list.find(run => run.id === event.runId);
      if (!run || run.state !== 'running' || !this.expects(run)) return;
      if (event.kind === 'stopping') this.processing.stopping(run.id);
      else if (event.kind === 'title') {
        run.rawTitle = event.title;
        this.callbacks.changed();
      } else if (event.kind === 'exit') {
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
    this.expectedRuns.set(panel.id, id);
    try {
      const launch = await this.processing.prepare(id, panel.agent, command, project.directory);
      const run = await this.terminal.start({ id, panelId: panel.id, projectId: project.id, directory: project.directory, ...launch });
      return run.state === 'failed' ? { ok: false, run, error: message('launchFailed') } : { ok: true, run };
    } catch (error) {
      // A missing response is not proof that the process never started. Preserve any
      // observed run and keep accepting its later events instead of retrying implicitly.
      // A failed terminal host has already stopped everything it ran and reports nothing more.
      const observed = this.list.find(run => run.id === id);
      const run = observed ?? { id, panelId: panel.id, projectId: project.id, state: this.terminalFailure ? 'stopped' as const : 'starting' as const };
      if (!observed) this.terminalEvent({ kind: 'started', run });
      return { ok: false, run: structuredClone(run), error: message('launchUnconfirmed', { reason: detail((error as Error).message) }) };
    }
  }
  /** Stops the project's runs; returns one reason per run that could not be stopped. */
  async stopProject(project: Project): Promise<string[]> {
    if (this.terminalFailure && this.list.some(run => run.projectId === project.id)) return [this.terminalFailure];
    const failures: string[] = [];
    for (const run of this.list.filter(run => run.projectId === project.id && (run.state === 'running' || run.state === 'starting'))) {
      // Mark before requesting cleanup: its exit event can arrive before the response.
      this.controlledStops.add(run.id);
      try { await this.terminal.stop(run.id); }
      catch (error) { failures.push(message('panelFailure', { number: project.panels.findIndex(panel => panel.id === run.panelId) + 1, reason: detail((error as Error).message) })); }
    }
    return failures;
  }
  /** Stops the panel's live run, which then exits like a run ending on its own. */
  async stopPanel(panelId: string) {
    const run = this.list.find(r => r.panelId === panelId && (r.state === 'running' || r.state === 'starting'));
    if (run) await this.terminal.stop(run.id);
  }
  /** Forgets runs of panels that no longer exist; their late events are ignored. */
  release(panelIds: string[]) {
    for (const id of panelIds) this.expectedRuns.delete(id);
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
