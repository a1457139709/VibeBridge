import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { message } from '../../app/shared/messages';
import { RunSupervision, type Terminal } from '../../app/main/runs/run-supervision';
import type { CommandCheck, Panel, Project, Run, TerminalEvent, WorkbenchEvent } from '../../app/shared/model';
import { testDirectory } from './directory';
import { cleanUpAfterFailure } from '../../app/shared/caught-error';

type Start = Parameters<Terminal['start']>[0];

class FakeTerminal implements Terminal {
  starts: Start[] = [];
  answer: 'running' | 'failed' | 'none' = 'running';
  private failure?: Error;
  constructor(
    private onEvent: (event: TerminalEvent) => void,
    private onFailure: (message: string, stopped?: boolean) => void,
    private onShutdown: () => Promise<void>,
  ) {}
  event(event: TerminalEvent) {
    this.onEvent(event);
  }
  crash(reason: string) {
    this.failure = new Error(reason);
    this.onFailure(reason, true);
  }
  private check() {
    if (this.failure) throw this.failure;
  }
  async start(value: Start): Promise<Run> {
    this.check();
    this.starts.push(value);
    if (this.answer === 'none') throw new Error(message('terminalTimeout'));
    const run: Run = {
      id: value.id,
      panelId: value.panelId,
      projectId: value.projectId,
      state: this.answer,
      ...(this.answer === 'running' ? { pid: 1 } : {}),
    };
    this.event({ kind: 'started', run });
    return run;
  }
  async stop(runId: string) {
    this.check();
    this.event({ kind: 'stopping', runId });
    this.event({ kind: 'exit', runId });
  }
  async input() {
    this.check();
  }
  async resize() {
    this.check();
  }
  acknowledgeOutput() {}
  async checkCommand(): Promise<CommandCheck> {
    return { available: true, path: '/bin/agent' };
  }
  async shutdown() {
    await this.onShutdown();
  }
}

export async function runSupervisionFixture(context: TestContext) {
  const directory = await testDirectory(context, 'run-supervision');
  const exited: Run[] = [],
    errors: string[] = [],
    emitted: WorkbenchEvent[] = [];
  let changes = 0;
  let onShutdown = async () => {};
  let terminal!: FakeTerminal;
  const supervision = new RunSupervision(
    directory,
    {
      onRunsChanged: () => {
        changes++;
      },
      onTerminalEvent: event => emitted.push(event),
      onFailure: message => errors.push(message),
      onRunExited: run => exited.push(run),
    },
    (onEvent, onFailure) => (terminal = new FakeTerminal(onEvent, onFailure, () => onShutdown())),
  );
  context.after(() => cleanUpAfterFailure(supervision.shutdown()));
  const project: Project = {
    id: 'project',
    name: 'Project',
    directory,
    panels: [
      { id: 'one', agent: 'codex' },
      { id: 'two', agent: 'codex' },
    ],
    layout: null,
  };
  const command = { command: 'agent', args: [] };
  const credentials = new Map<string, { url: string; runId: string; agent: string; token: string }>();
  const f = {
    supervision,
    terminal,
    project,
    exited,
    errors,
    emitted,
    changes: () => changes,
    onShutdown: (action: () => Promise<void>) => {
      onShutdown = action;
    },
    async start(panel: Panel = project.panels[0]) {
      const launch = await supervision.start(project, panel, command);
      const start = terminal.starts.find(start => start.id === launch.run.id);
      if (start) credentials.set(launch.run.id, JSON.parse(start.extraEnvironment.VIBEBRIDGE_STATUS_CONTEXT));
      return launch;
    },
    enter: (runId: string, session: string) =>
      f.report(runId, { hook_event_name: 'SessionStart', source: 'resume', session_id: session }),
    runs: () => project.panels.flatMap(panel => supervision.panelView(panel).run ?? []),
    run: (id: string) => project.panels.map(panel => supervision.panelView(panel).run).find(run => run?.id === id),
    async report(runId: string, payload: object = {}) {
      const context = credentials.get(runId);
      assert.ok(context, `run ${runId} has no status context`);
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, payload }) });
      await response.text();
      return response.status;
    },
  };
  return f;
}
