import test from 'node:test';
import assert from 'node:assert/strict';
import { runSupervisionFixture as fixture } from './support/run-supervision';

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
  assert.deepEqual(
    f.supervision.locate('first'),
    { projectId: 'project', panelId: 'one' },
    'resuming the session finds the panel again',
  );
});

test('a session is not located once its run has ended or its panel is released', async context => {
  const f = await fixture(context);
  const { run: exiting } = await f.start(f.project.panels[0]);
  const { run: released } = await f.start(f.project.panels[1]);
  await f.enter(exiting.id, 'exiting');
  await f.enter(released.id, 'released');
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  assert.equal(f.supervision.locate('exiting'), undefined);
  f.supervision.releasePanels([released.panelId]);
  assert.equal(f.supervision.locate('released'), undefined);
});

test("a pending dispatch is handed the run's first session ID, once", async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  assert.equal(
    f.supervision.awaitFirstSession(run.id, session => handed.push(session)),
    true,
  );
  await f.report(run.id, { hook_event_name: 'UserPromptSubmit' });
  assert.deepEqual(handed, [], 'a fact without a session hands nothing over');
  await f.enter(run.id, 'first');
  await f.enter(run.id, 'second');
  assert.deepEqual(handed, ['first']);
});

test("every pending dispatch held before the run's first session is handed that session", async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  f.supervision.awaitFirstSession(run.id, session => handed.push(`one:${session}`));
  f.supervision.awaitFirstSession(run.id, session => handed.push(`two:${session}`));
  await f.enter(run.id, 'first');
  assert.deepEqual(handed, ['one:first', 'two:first']);
});

test('shutdown drops pending dispatches', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const handed: string[] = [];
  f.supervision.awaitFirstSession(run.id, session => handed.push(session));
  await f.supervision.shutdown();
  assert.equal(
    f.supervision.awaitFirstSession(run.id, session => handed.push(session)),
    false,
  );
  assert.deepEqual(handed, []);
});

test('a pending dispatch on a run already on a session is handed that session at once', async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  await f.enter(run.id, 'current');
  const handed: string[] = [];
  assert.equal(
    f.supervision.awaitFirstSession(run.id, session => handed.push(session)),
    true,
  );
  assert.deepEqual(handed, ['current']);
});

test('a pending dispatch is dropped when its run ends before reporting a session', async context => {
  const f = await fixture(context);
  const handed: string[] = [];
  const hold = (runId: string) => f.supervision.awaitFirstSession(runId, session => handed.push(session));
  const { run: exiting } = await f.start(f.project.panels[0]);
  assert.equal(hold(exiting.id), true);
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  assert.equal(
    await f.report(exiting.id, { hook_event_name: 'SessionStart', source: 'startup', session_id: 'late' }),
    403,
  );
  const { run: stopped } = await f.start(f.project.panels[0]);
  assert.equal(hold(stopped.id), true);
  await f.supervision.stopPanel(stopped.panelId);
  const { run: next } = await f.start(f.project.panels[0]);
  await f.enter(next.id, 'next');
  const { run: released } = await f.start(f.project.panels[1]);
  assert.equal(hold(released.id), true);
  f.supervision.releasePanels([released.panelId]);
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
  f.supervision.awaitFirstSession(run.id, session => handed.push(session));
  f.terminal.crash('host gone');
  assert.equal(
    f.supervision.awaitFirstSession(run.id, session => handed.push(session)),
    false,
  );
  assert.deepEqual(handed, []);
});

test("what waits for a run's first ready report runs on it, once, or at once when the run has reported ready before", async context => {
  const f = await fixture(context);
  const { run } = await f.start();
  const readied: string[] = [];
  assert.equal(
    f.supervision.awaitFirstReady(run.id, () => {
      readied.push('first');
    }),
    true,
  );
  await f.report(run.id, { hook_event_name: 'UserPromptSubmit' });
  assert.equal(readied.length, 0, 'a busy report is not ready');
  await f.enter(run.id, 'session');
  await f.enter(run.id, 'session');
  assert.deepEqual(readied, ['first']);
  assert.equal(
    f.supervision.awaitFirstReady(run.id, () => {
      readied.push('now');
    }),
    true,
  );
  await f.report(run.id, { hook_event_name: 'UserPromptSubmit' });
  assert.equal(
    f.supervision.awaitFirstReady(run.id, () => {
      readied.push('busy since');
    }),
    true,
  );
  assert.deepEqual(readied, ['first', 'now', 'busy since']);
});

test("waiting for a run's first ready report is dropped when the run ends first, and refused for a run that cannot report", async context => {
  const f = await fixture(context);
  const readied: string[] = [];
  const { run } = await f.start();
  assert.equal(
    f.supervision.awaitFirstReady(run.id, () => readied.push('ended')),
    true,
  );
  f.terminal.event({ kind: 'exit', runId: run.id });
  assert.equal(
    f.supervision.awaitFirstReady(run.id, () => readied.push('late')),
    false,
  );
  f.terminal.answer = 'failed';
  const { run: failed } = await f.start();
  assert.equal(
    f.supervision.awaitFirstReady(failed.id, () => readied.push('failed')),
    false,
  );
  assert.deepEqual(readied, []);
});

test('a pending dispatch tells its holder when it is dropped', async context => {
  const f = await fixture(context);
  const events: string[] = [];
  const { run: exiting } = await f.start(f.project.panels[0]);
  f.supervision.awaitFirstSession(
    exiting.id,
    session => events.push(`handed:${session}`),
    () => events.push('exited'),
  );
  f.terminal.event({ kind: 'exit', runId: exiting.id });
  const { run: released } = await f.start(f.project.panels[1]);
  f.supervision.awaitFirstSession(
    released.id,
    session => events.push(`handed:${session}`),
    () => events.push('released'),
  );
  f.supervision.releasePanels([released.panelId]);
  const { run: handed } = await f.start(f.project.panels[0]);
  f.supervision.awaitFirstSession(
    handed.id,
    session => events.push(`handed:${session}`),
    () => events.push('dropped after hand-over'),
  );
  await f.enter(handed.id, 'first');
  f.terminal.event({ kind: 'exit', runId: handed.id });
  assert.deepEqual(events, ['exited', 'released', 'handed:first']);
});
