import { randomUUID } from 'node:crypto';
import { message, nestedMessage } from '../../shared/messages';
import {
  isLiveRun,
  type AgentCommand,
  type AgentType,
  type LaunchResult,
  type Panel,
  type PanelView,
  type Project,
  type Run,
  type TerminalEvent,
  type WorkbenchEvent,
} from '../../shared/model';
import { ProcessingStatus, type SessionReceiver } from './processing-status';
import { sessionTitle } from './session-title';
import { TerminalClient } from './terminal-client';
import { errorMessage } from '../../shared/caught-error';

export type Terminal = Pick<
  TerminalClient,
  'start' | 'checkCommand' | 'input' | 'resize' | 'stop' | 'acknowledgeOutput' | 'shutdown'
>;
export type TerminalFactory = (
  onEvent: (event: TerminalEvent) => void,
  onFailure: (message: string, stopped?: boolean) => void,
) => Terminal;

export interface PanelLocation {
  projectId: string;
  panelId: string;
}

export interface SupervisionCallbacks {
  onRunsChanged(): void;
  onTerminalEvent(event: WorkbenchEvent): void;
  onFailure(message: string): void;
  onRunExited(run: Run): void;
}

export class RunSupervision {
  private runs: Run[] = [];
  private processing: ProcessingStatus;
  private terminal: Terminal;
  private expectedRuns = new Map<string, { runId: string; agent: AgentType }>();
  private controlledStops = new Set<string>();
  private terminalFailure?: string;
  constructor(
    dataDirectory: string,
    private callbacks: SupervisionCallbacks,
    terminal: TerminalFactory = (onEvent, onFailure) => new TerminalClient(dataDirectory, onEvent, onFailure),
  ) {
    this.processing = new ProcessingStatus(() => callbacks.onRunsChanged(), dataDirectory);
    this.terminal = terminal(
      event => this.acceptTerminalEvent(event),
      (message, stopped) => {
        if (stopped) {
          this.terminalFailure = message;
          for (const run of this.runs)
            if (isLiveRun(run)) {
              run.state = 'stopped';
              this.processing.release(run.id);
            }
          callbacks.onRunsChanged();
        }
        callbacks.onFailure(message);
      },
    );
  }
  panelView(panel: Panel): PanelView {
    const run = this.runs.find(run => run.panelId === panel.id);
    if (!run) return { ...panel };
    const status = this.processing.status(run);
    return status ? { ...panel, run, status } : { ...panel, run };
  }
  locate(sessionId: string): PanelLocation | undefined {
    const run = this.runs.find(run => this.current(run) && this.processing.sessionId(run.id) === sessionId);
    return run && { projectId: run.projectId, panelId: run.panelId };
  }
  awaitFirstSession(runId: string, handOver: SessionReceiver, onReleased?: () => void) {
    const run = this.runs.find(run => run.id === runId);
    return !!run && this.current(run) && this.processing.awaitFirstSession(runId, handOver, onReleased);
  }
  awaitFirstReady(runId: string, onFirstReady: () => void) {
    const run = this.runs.find(run => run.id === runId);
    return !!run && this.current(run) && this.processing.awaitFirstReady(runId, onFirstReady);
  }
  private current(run: Run) {
    return isLiveRun(run) && this.isExpected(run);
  }
  isExpected(run: Run) {
    return this.expectedRuns.get(run.panelId)?.runId === run.id;
  }
  private acceptTerminalEvent(event: TerminalEvent) {
    if (event.kind === 'started') {
      if (!this.isExpected(event.run)) return;
      this.processing.trackRunState(event.run);
      this.runs = this.runs.filter(run => run.panelId !== event.run.panelId).concat(event.run);
      this.callbacks.onRunsChanged();
    } else {
      const run = this.runs.find(run => run.id === event.runId);
      if (!run || run.state !== 'running' || !this.isExpected(run)) return;
      if (event.kind === 'stopping') {
        this.processing.stopAccepting(run.id);
        return;
      }
      if (event.kind === 'title') {
        const expected = this.expectedRuns.get(run.panelId);
        if (!expected) return;
        const title = sessionTitle(expected.agent, event.title);
        if (title === run.title) return;
        if (title) run.title = title;
        else delete run.title;
        this.callbacks.onRunsChanged();
        return;
      }
      if (event.kind === 'exit') {
        this.processing.release(run.id);
        const controlled = this.controlledStops.delete(run.id);
        if (controlled) run.state = 'stopped';
        else this.runs = this.runs.filter(r => r.id !== run.id);
        if (!controlled) this.callbacks.onRunExited(run);
        this.callbacks.onRunsChanged();
      }
    }
    this.callbacks.onTerminalEvent(event);
  }
  async start(project: Project, panel: Panel, command: AgentCommand): Promise<LaunchResult> {
    const id = randomUUID();
    this.expectedRuns.set(panel.id, { runId: id, agent: panel.agent });
    try {
      const launch = await this.processing.prepare(id, panel.agent, command, project.directory);
      const run = await this.terminal.start({
        id,
        panelId: panel.id,
        projectId: project.id,
        directory: project.directory,
        ...launch,
      });
      return { outcome: run.state === 'failed' ? 'failed' : 'started', run, agent: panel.agent };
    } catch (error) {
      const observed = this.runs.find(run => run.id === id);
      const run = observed ?? {
        id,
        panelId: panel.id,
        projectId: project.id,
        state: this.terminalFailure ? ('stopped' as const) : ('starting' as const),
      };
      if (!observed) this.acceptTerminalEvent({ kind: 'started', run });
      return {
        outcome: 'unconfirmed',
        run: structuredClone(run),
        agent: panel.agent,
        reason: message('launchUnconfirmed', { reason: nestedMessage(errorMessage(error)) }),
      };
    }
  }
  async stopPanels(panels: Panel[]): Promise<string[]> {
    const ids = panels.map(panel => panel.id);
    if (this.terminalFailure && this.runs.some(run => ids.includes(run.panelId))) return [this.terminalFailure];
    const failures: string[] = [];
    for (const run of this.runs.filter(run => ids.includes(run.panelId) && isLiveRun(run))) {
      this.controlledStops.add(run.id);
      try {
        await this.terminal.stop(run.id);
      } catch (error) {
        failures.push(
          message('panelFailure', {
            number: ids.indexOf(run.panelId) + 1,
            reason: nestedMessage(errorMessage(error)),
          }),
        );
      }
    }
    return failures;
  }
  async stopPanel(panelId: string) {
    const run = this.runs.find(r => r.panelId === panelId && isLiveRun(r));
    if (!run) return;
    this.controlledStops.add(run.id);
    try {
      await this.terminal.stop(run.id);
    } catch (error) {
      this.controlledStops.delete(run.id);
      throw error;
    }
  }
  releasePanels(panelIds: string[]) {
    for (const id of panelIds) this.expectedRuns.delete(id);
    for (const run of this.runs) if (panelIds.includes(run.panelId)) this.processing.release(run.id);
    this.runs = this.runs.filter(r => !panelIds.includes(r.panelId));
  }
  input(runId: string, data: string) {
    return this.terminal.input(runId, data);
  }
  resize(runId: string, cols: number, rows: number) {
    return this.terminal.resize(runId, cols, rows);
  }
  acknowledgeOutput(runId: string, characters: number) {
    this.terminal.acknowledgeOutput(runId, characters);
  }
  checkCommand(command: string) {
    return this.terminal.checkCommand(command);
  }
  async shutdown() {
    let error: unknown;
    try {
      await this.terminal.shutdown();
    } catch (failure) {
      error = failure;
    }
    try {
      await this.processing.close();
    } catch (failure) {
      error ??= failure;
    }
    if (error) throw error;
  }
}
