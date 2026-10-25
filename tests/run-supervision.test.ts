import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { message } from '../app/shared/messages';
import { RunSupervision, type Terminal } from '../app/main/run-supervision';
import type { CommandCheck, Panel, Project, Run, TerminalEvent } from '../app/shared/model';
import { testDirectory } from './support/directory';

type Start = Parameters<Terminal['start']>[0];

// An in-memory terminal host. Like the real host it reports `started` before answering
// a start, and `stopping` then `exit` before answering a stop.
class FakeTerminal implements Terminal {
  starts: Start[] = [];
  answer: 'running' | 'failed' | 'none' = 'running';
  private failure?: Error;
  constructor(private onEvent: (event: TerminalEvent) => void, private onFailure: (message: string, stopped?: boolean) => void, private onShutdown: () => Promise<void>) {}
  event(event: TerminalEvent) { this.onEvent(event); }
  crash(reason: string) { this.failure = new Error(reason); this.onFailure(reason, true); }
  private check() { if (this.failure) throw this.failure; }
  async start(value: Start): Promise<Run> {
    this.check();
    this.starts.push(value);
    if (this.answer === 'none') throw new Error(message('terminalTimeout'));
    const run: Run = { id: value.id, panelId: value.panelId, projectId: value.projectId, state: this.answer, ...(this.answer === 'running' ? { pid: 1 } : {}) };
    this.event({ kind: 'started', run });
    return run;
  }
  async stop(runId: string) {
    this.check();
    this.event({ kind: 'stopping', runId });
    this.event({ kind: 'exit', runId });
  }
  async input() { this.check(); }
  async resize() { this.check(); }
  acknowledgeOutput() {}
  async checkCommand(): Promise<CommandCheck> { return { available: true, path: '/bin/agent' }; }
  async shutdown() { await this.onShutdown(); }
}

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'run-supervision');
  const exited: Run[] = [], errors: string[] = [], emitted: TerminalEvent[] = [];
  let changes = 0;
  let onShutdown = async () => {};
  let terminal!: FakeTerminal;
  const supervision = new RunSupervision(directory, {
    changed: () => { changes++; }, emit: event => emitted.push(event), report: message => errors.push(message), onRunExited: run => exited.push(run),
  }, (onEvent, onFailure) => terminal = new FakeTerminal(onEvent, onFailure, () => onShutdown()));
  context.after(() => supervision.shutdown().catch(() => {}));
  const project: Project = { id: 'project', name: 'Project', directory, panels: [{ id: 'one', agent: 'codex' }, { id: 'two', agent: 'codex' }], layout: null };
  const command = { command: 'agent', args: [] };
  const credentials = new Map<string, { url: string; runId: string; agent: string; token: string }>();
  return { supervision, terminal, project, exited, errors, emitted, changes: () => changes,
    onShutdown: (action: () => Promise<void>) => { onShutdown = action; },
    async start(panel: Panel = project.panels[0]) {
      const launch = await supervision.start(project, panel, command);
      const start = terminal.starts.find(start => start.id === launch.run.id);
      if (start) credentials.set(launch.run.id, JSON.parse(start.integration.VIBEBRIDGE_STATUS_CONTEXT));
      return launch;
    },
    run: (id: string) => supervision.runs().find(run => run.id === id),
    // Reports as the Agent's own status integration would: 204 while observed, 403 once released.
    async report(runId: string) {
      const context = credentials.get(runId)!;
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1, scope: 'main', payload: {} }) });
      await response.text();
      return response.status;
    } };
}

test('a confirmed launch is running and observed, and announces itself', async context => {
  const f = await fixture(context);
  const launch = await f.start();
  assert.equal(launch.ok, true);
  assert.equal(f.run(launch.run.id)?.state, 'running');
  assert.equal(await f.report(launch.run.id), 204);
  assert.deepEqual(f.emitted.map(event => event.kind), ['started']);
  assert.ok(f.changes() > 0);
});

test('a failed launch reports launch failure and releases its observation at once', async context => {
  const f = await fixture(context);
  f.terminal.answer = 'failed';
  const launch = await f.start();
  assert.deepEqual(launch.ok ? '' : launch.error, message('launchFailed'));
  assert.equal(f.run(launch.run.id)?.state, 'failed');
  assert.equal(await f.report(launch.run.id), 403);
});

test('an unconfirmed launch stays starting and observed, then accepts the host\'s late start and exit', async context => {
  const f = await fixture(context);
  f.terminal.answer = 'none';
  const launch = await f.start();
  assert.match(launch.ok ? '' : launch.error, /launchUnconfirmed.*terminalTimeout/);
  assert.equal(f.run(launch.run.id)?.state, 'starting');
  assert.equal(await f.report(launch.run.id), 204, 'an unconfirmed launch may still be running');
  const { id, panelId, projectId } = launch.run;
  f.terminal.event({ kind: 'started', run: { id, panelId, projectId, state: 'running', pid: 2 } });
  f.terminal.event({ kind: 'title', runId: id, title: 'Late title' });
  assert.equal(f.run(id)?.state, 'running');
  assert.equal(f.run(id)?.rawTitle, 'Late title');
  f.terminal.event({ kind: 'exit', runId: id });
  assert.equal(f.run(id), undefined);
  assert.deepEqual(f.exited.map(run => run.id), [id]);
  assert.equal(await f.report(id), 403);
});

test('a run exiting on its own leaves the run list and is reported as exited, not stopped', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  f.terminal.event({ kind: 'exit', runId: run.id });
  assert.equal(f.run(run.id), undefined);
  assert.deepEqual(f.exited.map(item => item.id), [run.id]);
  assert.equal(f.supervision.expects(f.exited[0]), true, 'its panel still expects it until the workbench removes the panel');
  assert.equal(await f.report(run.id), 403);
});

test('stopping a project marks its runs stopped even though each exit arrives before the stop response', async context => {
  const f = await fixture(context);
  const { run: first } = await f.start(f.project.panels[0]);
  const { run: second } = await f.start(f.project.panels[1]);
  assert.deepEqual(await f.supervision.stopProject(f.project), []);
  assert.deepEqual([f.run(first.id)?.state, f.run(second.id)?.state], ['stopped', 'stopped']);
  assert.deepEqual(f.exited, [], 'a stop the workbench requested is not a run exit');
  assert.deepEqual([await f.report(first.id), await f.report(second.id)], [403, 403]);
});

test('stopping a panel ends its run like an exit, and released panels drop their runs and observations', async context => {
  const f = await fixture(context);
  const { run: closed } = await f.start(f.project.panels[0]);
  await f.supervision.stopPanel(closed.panelId);
  assert.deepEqual(f.exited.map(run => run.id), [closed.id]);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.supervision.release([pending.panelId]);
  assert.equal(f.run(pending.id), undefined);
  assert.equal(await f.report(pending.id), 403, 'a released panel keeps no observation, even for an unconfirmed launch');
  f.terminal.event({ kind: 'started', run: { ...pending, state: 'running' } });
  assert.equal(f.run(pending.id), undefined, 'late events of a released panel are ignored');
});

test('events of a replaced run are ignored', async context => {
  const f = await fixture(context);
  const { run: old } = await f.start();
  const { run: current } = await f.start();
  assert.deepEqual(f.supervision.runs().map(run => run.id), [current.id]);
  const emitted = f.emitted.length;
  for (const event of [{ kind: 'title', runId: old.id, title: 'Stale' }, { kind: 'output', runId: old.id, data: 'stale' }, { kind: 'exit', runId: old.id }] as TerminalEvent[]) f.terminal.event(event);
  f.terminal.event({ kind: 'started', run: { ...old, state: 'running' } });
  assert.equal(f.emitted.length, emitted);
  assert.deepEqual(f.exited, []);
  assert.deepEqual(f.supervision.runs().map(run => [run.id, run.rawTitle]), [[current.id, undefined]]);
});

test('a terminal host failure stops every run, releases observations and refuses later stops and launches', async context => {
  const f = await fixture(context);
  const { run } = await f.start(f.project.panels[0]);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.terminal.crash('host gone');
  assert.deepEqual(f.supervision.runs().map(item => item.state), ['stopped', 'stopped']);
  assert.deepEqual([await f.report(run.id), await f.report(pending.id)], [403, 403]);
  assert.deepEqual(f.errors, ['host gone']);
  assert.deepEqual(await f.supervision.stopProject(f.project), ['host gone']);
  const late = await f.supervision.start(f.project, f.project.panels[0], { command: 'agent', args: [] });
  assert.match(late.ok ? '' : late.error, /launchUnconfirmed/);
  assert.equal(f.run(late.run.id)?.state, 'stopped', 'nothing will ever report a launch the failed host never ran');
});

test('shutdown ends the terminal host while runs are still observed, then closes observation', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  let duringTerminalShutdown: number | undefined;
  f.onShutdown(async () => { duringTerminalShutdown = await f.report(run.id); });
  await f.supervision.shutdown();
  assert.equal(duringTerminalShutdown, 204);
  await assert.rejects(f.report(run.id), 'the status endpoint is closed');
});

test('checking a command passes through to the terminal host', async context => {
  const f = await fixture(context);
  assert.deepEqual(await f.supervision.checkCommand('agent'), { available: true, path: '/bin/agent' });
});
