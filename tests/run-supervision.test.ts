import test from 'node:test';
import assert from 'node:assert/strict';
import { message } from '../app/shared/messages';
import type { TerminalEvent } from '../app/shared/model';
import { runSupervisionFixture as fixture } from './support/run-supervision';

test('a confirmed launch is running and observed, and announces itself', async context => {
  const f = await fixture(context);
  const launch = await f.start();
  assert.equal(launch.outcome, 'started');
  assert.equal(f.run(launch.run.id)?.state, 'running');
  assert.equal(await f.report(launch.run.id), 204);
  assert.deepEqual(
    f.emitted.map(event => event.kind),
    ['started'],
  );
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

test("an unconfirmed launch stays starting and observed, then accepts the host's late start and exit", async context => {
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
  assert.deepEqual(
    f.exited.map(run => run.id),
    [id],
  );
  assert.equal(await f.report(id), 403);
});

test('a title spinner animating while busy publishes nothing until the session title changes', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const changes = f.changes(),
    emitted = f.emitted.length;
  for (const frame of ['⠋', '⠙', '⠹', '⠸', '⠼'])
    f.terminal.event({ kind: 'title', runId: run.id, title: `${frame} Fix tests | project` });
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
  assert.deepEqual(
    f.exited.map(item => item.id),
    [run.id],
  );
  assert.equal(
    f.supervision.isExpected(f.exited[0]),
    true,
    'its panel still expects it until the workbench removes the panel',
  );
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
  assert.deepEqual(
    f.emitted.map(event => event.kind),
    ['started', 'exit'],
    "the host's stopping fact stays in the main process",
  );
  assert.equal(await f.report(closed.id), 403);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.supervision.releasePanels([pending.panelId]);
  assert.equal(f.run(pending.id), undefined);
  assert.equal(
    await f.report(pending.id),
    403,
    'a released panel keeps no observation, even for an unconfirmed launch',
  );
  f.terminal.event({ kind: 'started', run: { ...pending, state: 'running' } });
  assert.equal(f.run(pending.id), undefined, 'late events of a released panel are ignored');
});

test('a run whose panel stop failed still counts as exiting on its own when it later exits', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  f.terminal.stop = async () => {
    throw new Error(message('terminalTimeout'));
  };
  await assert.rejects(f.supervision.stopPanel(run.panelId), /terminalTimeout/);
  f.terminal.event({ kind: 'exit', runId: run.id });
  assert.deepEqual(
    f.exited.map(item => item.id),
    [run.id],
  );
});

test('events of a replaced run are ignored', async context => {
  const f = await fixture(context);
  const { run: old } = await f.start();
  const { run: current } = await f.start();
  assert.deepEqual(
    f.runs().map(run => run.id),
    [current.id],
  );
  const emitted = f.emitted.length;
  const stale: TerminalEvent[] = [
    { kind: 'title', runId: old.id, title: 'Stale | project' },
    { kind: 'output', runId: old.id, data: 'stale' },
    { kind: 'exit', runId: old.id },
  ];
  for (const event of stale) f.terminal.event(event);
  f.terminal.event({ kind: 'started', run: { ...old, state: 'running' } });
  assert.equal(f.emitted.length, emitted);
  assert.deepEqual(f.exited, []);
  assert.deepEqual(
    f.runs().map(run => [run.id, run.title]),
    [[current.id, undefined]],
  );
});

test('a terminal host failure stops every run, releases observations and refuses later stops and launches', async context => {
  const f = await fixture(context);
  const { run } = await f.start(f.project.panels[0]);
  f.terminal.answer = 'none';
  const { run: pending } = await f.start(f.project.panels[1]);
  f.terminal.crash('host gone');
  assert.deepEqual(
    f.runs().map(item => item.state),
    ['stopped', 'stopped'],
  );
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
  f.onShutdown(async () => {
    duringTerminalShutdown = await f.report(run.id);
  });
  await f.supervision.shutdown();
  assert.equal(duringTerminalShutdown, 204);
  await assert.rejects(f.report(run.id), 'the status endpoint is closed');
});

test('checking a command passes through to the terminal host', async context => {
  const f = await fixture(context);
  assert.deepEqual(await f.supervision.checkCommand('agent'), { available: true, path: '/bin/agent' });
});
