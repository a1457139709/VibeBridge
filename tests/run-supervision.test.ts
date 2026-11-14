import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { message } from '../app/shared/messages';
import { RunSupervision, type Terminal } from '../app/main/run-supervision';
import type { CommandCheck, Panel, Project, Run, TerminalEvent, WorkbenchEvent } from '../app/shared/model';
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
  const directory = await testDirectory(context, 'run-lifecycle-cleanup');
  const exited: Run[] = [], errors: string[] = [], emitted: WorkbenchEvent[] = [];
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
  const f = { supervision, terminal, project, exited, errors, emitted, changes: () => changes,
    onShutdown: (action: () => Promise<void>) => { onShutdown = action; },
    async start(panel: Panel = project.panels[0]) {
      const launch = await supervision.start(project, panel, command);
      const start = terminal.starts.find(start => start.id === launch.run.id);
      if (start) credentials.set(launch.run.id, JSON.parse(start.integration.VIBEBRIDGE_STATUS_CONTEXT));
      return launch;
    },
    /** Reports that the run's Codex CLI started, cleared to or resumed this session. */
    enter: (runId: string, session: string) => f.report(runId, { hook_event_name: 'SessionStart', source: 'resume', session_id: session }),
    runs: () => project.panels.flatMap(panel => supervision.panelView(panel).run ?? []),
    run: (id: string) => project.panels.map(panel => supervision.panelView(panel).run).find(run => run?.id === id),
    // Reports as the Agent's own status integration would: 204 while observed, 403 once released.
    async report(runId: string, payload: object = {}) {
      const context = credentials.get(runId)!;
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, payload }) });
      await response.text();
      return response.status;
    } };
  return f;
}

test('a confirmed launch is running and observed, and announces itself', async context => {
  const f = await fixture(context);
  const launch = await f.start();
  assert.equal(launch.outcome, 'started');
  assert.equal(f.run(launch.run.id)?.state, 'running');
  assert.equal(await f.report(launch.run.id), 204);
  assert.deepEqual(f.emitted.map(event => event.kind), ['started']);
  assert.ok(f.changes() > 0);
});

test('a failed launch reports launch failure and releases its observation at once', async context => {
  const f = await fixture(context);
  f.terminal.answer = 'failed';
  const launch = await f.start();
  assert.equal(launch.outcome, 'failed');
  assert.equal(f.run(launch.run.id)?.state, 'failed');
  assert.equal(await f.report(launch.run.id), 403);
});

test('an unconfirmed launch stays starting and observed, then accepts the host\'s late start and exit', async context => {
  const f = await fixture(context);
  f.terminal.answer = 'none';
  const launch = await f.start();
  assert.equal(launch.outcome, 'unconfirmed');
  assert.match(launch.outcome === 'unconfirmed' ? launch.reason : '', /launchUnconfirmed.*terminalTimeout/);
  assert.equal(f.run(launch.run.id)?.state, 'starting');
  assert.equal(await f.report(launch.run.id), 204, 'an unconfirmed launch may still be running');
  const { id, panelId, projectId } = launch.run;
  f.terminal.event({ kind: 'started', run: { id, panelId, projectId, state: 'running', pid: 2 } });
  f.terminal.event({ kind: 'title', runId: id, title: '⠋ Late title | project' });
  assert.equal(f.run(id)?.state, 'running');
  assert.equal(f.run(id)?.title, 'Late title');
  f.terminal.event({ kind: 'exit', runId: id });
  assert.equal(f.run(id), undefined);
  assert.deepEqual(f.exited.map(run => run.id), [id]);
  assert.equal(await f.report(id), 403);
});

test('a title spinner animating while busy publishes nothing until the session title changes', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const changes = f.changes(), emitted = f.emitted.length;
  for (const frame of ['⠋', '⠙', '⠹', '⠸', '⠼']) f.terminal.event({ kind: 'title', runId: run.id, title: `${frame} Fix tests | project` });
  assert.equal(f.run(run.id)?.title, 'Fix tests');
  assert.equal(f.changes(), changes + 1, 'only the first frame changes the session title');
  f.terminal.event({ kind: 'title', runId: run.id, title: '⠴ Review | project' });
  assert.equal(f.run(run.id)?.title, 'Review');
  assert.equal(f.changes(), changes + 2);
  f.terminal.event({ kind: 'title', runId: run.id, title: 'project' });
  assert.equal(f.run(run.id)?.title, undefined, 'a title without a session name has no session title');
  assert.equal(f.changes(), changes + 3);
  assert.equal(f.emitted.length, emitted, 'title events stay in the main process');
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

test('stopping panels marks their runs stopped even though each exit arrives before the stop response', async context => {
  const f = await fixture(context);
  const { run: first } = await f.start(f.project.panels[0]);
  const { run: second } = await f.start(f.project.panels[1]);
  assert.deepEqual(await f.supervision.stopPanels(f.project.panels), []);
  assert.deepEqual([f.run(first.id)?.state, f.run(second.id)?.state], ['stopped', 'stopped']);
  assert.deepEqual(f.exited, [], 'a stop the workbench requested is not a run exit');
  assert.deepEqual([await f.report(first.id), await f.report(second.id)], [403, 403]);
});

test('stopping a panel is a controlled stop, and released panels drop their runs and observations', async context => {
  const f = await fixture(context);
  const { run: closed } = await f.start(f.project.panels[0]);
  await f.supervision.stopPanel(closed.panelId);
  assert.equal(f.run(closed.id)?.state, 'stopped');
  assert.deepEqual(f.exited, [], 'closing a panel is not a run exit');
  assert.deepEqual(f.emitted.map(event => event.kind), ['started', 'exit'], 'the host\'s stopping fact stays in the main process');
  assert.equal(await f.report(closed.id), 403);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.supervision.release([pending.panelId]);
  assert.equal(f.run(pending.id), undefined);
  assert.equal(await f.report(pending.id), 403, 'a released panel keeps no observation, even for an unconfirmed launch');
  f.terminal.event({ kind: 'started', run: { ...pending, state: 'running' } });
  assert.equal(f.run(pending.id), undefined, 'late events of a released panel are ignored');
});

test('a run whose panel stop failed still counts as exiting on its own when it later exits', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  f.terminal.stop = async () => { throw new Error(message('terminalTimeout')); };
  await assert.rejects(f.supervision.stopPanel(run.panelId), /terminalTimeout/);
  f.terminal.event({ kind: 'exit', runId: run.id });
  assert.deepEqual(f.exited.map(item => item.id), [run.id]);
});

test('events of a replaced run are ignored', async context => {
  const f = await fixture(context);
  const { run: old } = await f.start();
  const { run: current } = await f.start();
  assert.deepEqual(f.runs().map(run => run.id), [current.id]);
  const emitted = f.emitted.length;
  for (const event of [{ kind: 'title', runId: old.id, title: 'Stale | project' }, { kind: 'output', runId: old.id, data: 'stale' }, { kind: 'exit', runId: old.id }] as TerminalEvent[]) f.terminal.event(event);
  f.terminal.event({ kind: 'started', run: { ...old, state: 'running' } });
  assert.equal(f.emitted.length, emitted);
  assert.deepEqual(f.exited, []);
  assert.deepEqual(f.runs().map(run => [run.id, run.title]), [[current.id, undefined]]);
});

test('a terminal host failure stops every run, releases observations and refuses later stops and launches', async context => {
  const f = await fixture(context);
  const { run } = await f.start(f.project.panels[0]);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.terminal.crash('host gone');
  assert.deepEqual(f.runs().map(item => item.state), ['stopped', 'stopped']);
  assert.deepEqual([await f.report(run.id), await f.report(pending.id)], [403, 403]);
  assert.deepEqual(f.errors, ['host gone']);
  assert.deepEqual(await f.supervision.stopPanels(f.project.panels), ['host gone']);
  const late = await f.supervision.start(f.project, f.project.panels[0], { command: 'agent', args: [] });
  assert.equal(late.outcome, 'unconfirmed');
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

test('locating a session finds the panel whose run is on it now, following session switches', async context => {
  const f = await fixture(context);
  const { run } = await f.start(f.project.panels[0]);
  const { run: other } = await f.start(f.project.panels[1]);
  assert.equal(f.supervision.locate('first'), undefined, 'no run has reported a session yet');
  const changes = f.changes();
  await f.enter(run.id, 'first');
  assert.ok(f.changes() > changes, 'a session change publishes');
  await f.enter(other.id, 'elsewhere');
  assert.deepEqual(f.supervision.locate('first'), { projectId: 'project', panelId: 'one' });
  assert.deepEqual(f.supervision.locate('elsewhere'), { projectId: 'project', panelId: 'two' });
  await f.enter(run.id, 'cleared');
  assert.equal(f.supervision.locate('first'), undefined, 'the panel moved on to another session');
  assert.deepEqual(f.supervision.locate('cleared'), { projectId: 'project', panelId: 'one' });
  await f.enter(run.id, 'first');
  assert.deepEqual(f.supervision.locate('first'), { projectId: 'project', panelId: 'one' }, 'resuming the session finds the panel again');
});

test('a session is not located once its run has ended or its panel is released', async context => {
  const f = await fixture(context);
  const { run: exiting } = await f.start(f.project.panels[0]);
  const { run: released } = await f.start(f.project.panels[1]);
  await f.enter(exiting.id, 'exiting');
  await f.enter(released.id, 'released');
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  assert.equal(f.supervision.locate('exiting'), undefined);
  f.supervision.release([released.panelId]);
  assert.equal(f.supervision.locate('released'), undefined);
});

test('a pending dispatch is handed the run\'s first session ID, once', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  assert.equal(f.supervision.holdDispatch(run.id, session => handed.push(session)), true);
  await f.report(run.id, { hook_event_name: 'UserPromptSubmit' });
  assert.deepEqual(handed, [], 'a fact without a session hands nothing over');
  await f.enter(run.id, 'first');
  await f.enter(run.id, 'second');
  assert.deepEqual(handed, ['first']);
});

test('every pending dispatch held before the run\'s first session is handed that session', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  f.supervision.holdDispatch(run.id, session => handed.push(`one:${session}`));
  f.supervision.holdDispatch(run.id, session => handed.push(`two:${session}`));
  await f.enter(run.id, 'first');
  assert.deepEqual(handed, ['one:first', 'two:first']);
});

test('shutdown drops pending dispatches', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  f.supervision.holdDispatch(run.id, session => handed.push(session));
  await f.supervision.shutdown();
  assert.equal(f.supervision.holdDispatch(run.id, session => handed.push(session)), false);
  assert.deepEqual(handed, []);
});

test('a pending dispatch on a run already on a session is handed that session at once', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  await f.enter(run.id, 'current');
  const handed: string[] = [];
  assert.equal(f.supervision.holdDispatch(run.id, session => handed.push(session)), true);
  assert.deepEqual(handed, ['current']);
});

test('a pending dispatch is dropped when its run ends before reporting a session', async context => {
  const f = await fixture(context);
  const handed: string[] = [];
  const hold = (runId: string) => f.supervision.holdDispatch(runId, session => handed.push(session));
  const { run: exiting } = await f.start(f.project.panels[0]);
  assert.equal(hold(exiting.id), true);
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  assert.equal(await f.report(exiting.id, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'late' }), 403);
  const { run: stopped } = await f.start(f.project.panels[0]);
  assert.equal(hold(stopped.id), true);
  await f.supervision.stopPanel(stopped.panelId);
  const { run: next } = await f.start(f.project.panels[0]);
  await f.enter(next.id, 'next');
  const { run: released } = await f.start(f.project.panels[1]);
  assert.equal(hold(released.id), true);
  f.supervision.release([released.panelId]);
  f.terminal.answer = 'failed';
  const { run: failed } = await f.start(f.project.panels[0]);
  assert.equal(hold(failed.id), false, 'a run that failed to launch can never report a session');
  assert.equal(hold('unknown'), false);
  assert.deepEqual(handed, []);
});

test('a terminal host failure drops pending dispatches', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  f.supervision.holdDispatch(run.id, session => handed.push(session));
  f.terminal.crash('host gone');
  assert.equal(f.supervision.holdDispatch(run.id, session => handed.push(session)), false);
  assert.deepEqual(handed, []);
});

test('what waits for a run to be ready runs on its first ready report, once, or at once when it shows ready now', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const readied: string[] = [];
  assert.equal(f.supervision.whenReady(run.id, () => { readied.push('first'); }), true);
  await f.report(run.id, { hook_event_name: 'UserPromptSubmit' });
  assert.equal(readied.length, 0, 'a busy report is not ready');
  await f.enter(run.id, 'session');
  await f.enter(run.id, 'session');
  assert.deepEqual(readied, ['first']);
  assert.equal(f.supervision.whenReady(run.id, () => { readied.push('now'); }), true);
  assert.deepEqual(readied, ['first', 'now']);
});

test('waiting for a run to be ready is dropped when the run ends first, and refused for a run that cannot report', async context => {
  const f = await fixture(context);
  const readied: string[] = [];
  const { run } = await f.start();
  assert.equal(f.supervision.whenReady(run.id, () => readied.push('ended')), true);
  f.terminal.event({ kind: 'exit', runId: run.id });
  assert.equal(f.supervision.whenReady(run.id, () => readied.push('late')), false);
  f.terminal.answer = 'failed';
  const { run: failed } = await f.start();
  assert.equal(f.supervision.whenReady(failed.id, () => readied.push('failed')), false);
  assert.deepEqual(readied, []);
});

test('a pending dispatch tells its holder when it is dropped', async context => {
  const f = await fixture(context);
  const events: string[] = [];
  const { run: exiting } = await f.start(f.project.panels[0]);
  f.supervision.holdDispatch(exiting.id, session => events.push(`handed:${session}`), () => events.push('exited'));
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  const { run: released } = await f.start(f.project.panels[1]);
  f.supervision.holdDispatch(released.id, session => events.push(`handed:${session}`), () => events.push('released'));
  f.supervision.release([released.panelId]);
  const { run: handed } = await f.start(f.project.panels[0]);
  f.supervision.holdDispatch(handed.id, session => events.push(`handed:${session}`), () => events.push('dropped after hand-over'));
  await f.enter(handed.id, 'first');
  f.terminal.event({ kind: 'exit', runId: handed.id });
  assert.deepEqual(events, ['exited', 'released', 'handed:first']);
});

test('checking a command passes through to the terminal host', async context => {
  const f = await fixture(context);
  assert.deepEqual(await f.supervision.checkCommand('agent'), { available: true, path: '/bin/agent' });
});
