import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Workbench } from '../app/main/workbench';
import { bracketedPaste } from '../app/shared/dispatch';
import type { WorkbenchEvent } from '../app/shared/model';
import { testDirectory } from './support/directory';
import { ghDouble } from './support/gh-double';
import { until } from './support/cli-double';

const paste = (text: string) => Buffer.from(`\x1b[200~${text}\x1b[201~`).toString('hex');

/** A Workbench in `directory` whose Claude Code panels run the Claude CLI double, echoing every input's bytes. */
async function open(context: TestContext, directory: string) {
  const workbench = await Workbench.open(directory);
  context.after(() => workbench.quit());
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.acknowledgeOutput(event.runId, event.data.length);
  });
  const output = (runId: string) => events.flatMap(e => e.kind === 'output' && e.runId === runId ? [e.data] : []).join('');
  let sequence = 0;
  /** Sends the Claude CLI double one request and waits for its acknowledgement. */
  async function request(runId: string, fields: object) {
    const id = ++sequence;
    await workbench.sendInput(runId, JSON.stringify({ id, ...fields }) + '\n');
    await until(() => output(runId).includes(`ACK:${id}\r\n`), () => output(runId));
  }
  return { workbench, output, request,
    view: (id: string) => workbench.snapshot().projects.find(project => project.id === id)!,
    /** Has the Claude CLI double report this session as resumed. */
    resume: (runId: string, session: string) => request(runId, { payload: { hook_event_name: 'SessionStart', session_id: session, source: 'resume' } }),
    /** Has the Claude CLI double report its startup session, which makes it Ready. */
    start: (runId: string) => request(runId, { payload: { hook_event_name: 'SessionStart', source: 'startup' } }),
    /** The launch arguments the Claude CLI double received. */
    async arguments(runId: string): Promise<string[]> {
      await request(runId, { arguments: true });
      return JSON.parse(/ARGUMENTS:(.*)\r\n/.exec(output(runId))![1]);
    } };
}

/** A project bound to octo/app with one Claude Code panel that has reported its first session. */
async function dispatchable(context: TestContext, scope: string) {
  await ghDouble(context, { login: 'octo', repositories: ['octo/app', 'octo/docs'] });
  const directory = await testDirectory(context, scope);
  const f = await open(context, directory);
  const agents = f.workbench.snapshot().settings.agents;
  agents.claude = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/claude-cli.cjs'), '--echo-bytes'] };
  await f.workbench.saveSettings({ agents });
  const { project, launches: [{ run }] } = await f.workbench.createProject({ name: 'Bound', directory, total: 1, counts: { codex: 0, claude: 1, pi: 0 } });
  await f.workbench.bindRepository(project.id, { platform: 'github', path: 'octo/app' });
  await until(() => f.output(run.id).includes('CLI-DOUBLE-READY') && f.view(project.id).panels[0].status === 'ready', () => f.output(run.id));
  return { ...f, directory, project, run, panelId: project.panels[0].id, session: `session-${run.pid}`,
    /** New Claude Code panels report neither a session nor Ready until the test has them start. */
    async holdSessions() {
      agents.claude = { ...agents.claude, args: [...agents.claude.args, '--hold-session'] };
      await f.workbench.saveSettings({ agents });
    } };
}

test('dispatching to an existing panel pastes the instruction into its terminal, adding a return to submit, and records it on the panel session', async context => {
  const f = await dispatchable(context, 'dispatch-existing');
  await f.workbench.dispatch(f.project.id, { issue: { number: 7, title: 'Crash' }, workflow: 'matt', instruction: 'to-spec', target: { panelId: f.panelId }, invert: false });
  const submitted = paste('/to-spec https://github.com/octo/app/issues/7') + '0d';
  await until(() => f.output(f.run.id).includes(`BYTES:${submitted}`), () => f.output(f.run.id));

  await f.workbench.dispatch(f.project.id, { issue: { number: 7, title: 'Crash' }, workflow: 'matt', instruction: 'triage', target: { panelId: f.panelId }, invert: true });
  const filled = paste('/triage look at https://github.com/octo/app/issues/7');
  await until(() => f.output(f.run.id).includes(`BYTES:${filled}\r\n`), () => f.output(f.run.id));

  const { dispatches } = f.view(f.project.id);
  assert.deepEqual(dispatches.map(({ issue, agent, text, location }) => ({ issue, agent, text, location })), [
    { issue: 7, agent: 'claude', text: '/triage look at https://github.com/octo/app/issues/7',
      location: { projectId: f.project.id, panelId: f.panelId, runId: f.run.id, ephemeral: false, status: 'ready' } },
    { issue: 7, agent: 'claude', text: '/to-spec https://github.com/octo/app/issues/7',
      location: { projectId: f.project.id, panelId: f.panelId, runId: f.run.id, ephemeral: false, status: 'ready' } },
  ], 'newest first, each located on the panel that holds its session');
  assert.ok(Date.parse(dispatches[1].time) <= Date.parse(dispatches[0].time));
});

test('a dispatch record follows its session: a session switch loses the panel, switching back finds it again', async context => {
  const f = await dispatchable(context, 'dispatch-session-switch');
  await f.workbench.dispatch(f.project.id, { issue: { number: 3, title: 'Docs' }, workflow: 'matt', instruction: 'tdd', target: { panelId: f.panelId }, invert: false });
  await until(() => f.view(f.project.id).dispatches[0]?.location?.panelId === f.panelId);
  await f.resume(f.run.id, 'other');
  await until(() => f.view(f.project.id).dispatches[0].location === null);
  await f.resume(f.run.id, f.session);
  await until(() => f.view(f.project.id).dispatches[0].location?.panelId === f.panelId);
});

test('dispatch records outlive the panel and the app run, follow the binding, and leave with the project', async context => {
  const f = await dispatchable(context, 'dispatch-records-kept');
  await f.workbench.dispatch(f.project.id, { issue: { number: 5, title: 'Kept' }, workflow: 'matt', instruction: 'implement', target: { panelId: f.panelId }, invert: false });
  await until(() => f.view(f.project.id).dispatches.length === 1);
  await f.workbench.closePanel(f.project.id, f.panelId);
  assert.deepEqual(f.view(f.project.id).dispatches.map(record => [record.issue, record.location]), [[5, null]], 'closing the panel keeps the record');

  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/docs' });
  assert.deepEqual(f.view(f.project.id).dispatches, [], 'records of another repository are hidden');
  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/app' });
  assert.equal(f.view(f.project.id).dispatches.length, 1, 'binding the repository again shows its records');
  await f.workbench.quit();

  const reopened = await open(context, f.directory);
  const records = reopened.view(f.project.id).dispatches;
  assert.deepEqual(records.map(({ issue, agent, text, location }) => ({ issue, agent, text, location })),
    [{ issue: 5, agent: 'claude', text: '/implement https://github.com/octo/app/issues/5', location: null }], 'the record survives a restart, unlocated');
  await reopened.workbench.deleteProject(f.project.id);
  await reopened.workbench.quit();
  const database = new DatabaseSync(join(f.directory, 'projects.sqlite'), { readOnly: true });
  context.after(() => database.close());
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM dispatch_records').get()!.count, 0, 'a deleted project takes its records with it');
});

test('a dispatch names an enabled instruction and a panel of the project with a running Agent', async context => {
  const f = await dispatchable(context, 'dispatch-invalid');
  const request = { issue: { number: 1, title: 'One' }, workflow: 'matt', instruction: 'to-spec', target: { panelId: f.panelId }, invert: false };
  await assert.rejects(f.workbench.dispatch(f.project.id, { ...request, instruction: 'unknown' }), /instructionUnavailable/);
  await assert.rejects(f.workbench.dispatch(f.project.id, { ...request, target: { panelId: 'elsewhere' } }), /panelMissing/);
  const workflows = f.workbench.snapshot().settings.workflows;
  workflows.matt.enabled = false;
  await f.workbench.saveSettings({ workflows });
  await assert.rejects(f.workbench.dispatch(f.project.id, request), /instructionUnavailable/);
  assert.deepEqual(f.view(f.project.id).dispatches, []);
});

test('dispatching to a new panel and submitting launches it with the instruction, and records it once the panel reports a session', async context => {
  const f = await dispatchable(context, 'dispatch-new-submit');
  await f.holdSessions();
  const creation = await f.workbench.dispatch(f.project.id, { issue: { number: 9, title: 'New' }, workflow: 'matt', instruction: 'to-spec', target: { agent: 'claude' }, invert: false });
  assert.equal(creation?.launch.outcome, 'started');
  const { panel, launch: { run } } = creation!;
  assert.deepEqual(f.view(f.project.id).tray.map(panel => panel.id), [panel.id], 'the new panel joins the tray');
  assert.deepEqual((await f.arguments(run.id)).slice(0, 3), ['--echo-bytes', '--hold-session', '/to-spec https://github.com/octo/app/issues/9'],
    'the instruction follows the Agent settings arguments');
  assert.deepEqual(f.view(f.project.id).dispatches.map(({ issue, text, location }) => ({ issue, text, location: location && { panelId: location.panelId, runId: location.runId, ephemeral: location.ephemeral } })),
    [{ issue: 9, text: '/to-spec https://github.com/octo/app/issues/9', location: { panelId: panel.id, runId: run.id, ephemeral: true } }],
    'before its session is known the issue already shows the new panel');
  await f.start(run.id);
  await f.workbench.closePanel(f.project.id, panel.id);
  await until(() => f.view(f.project.id).dispatches.length === 1 && f.view(f.project.id).dispatches[0].location === null,
    () => JSON.stringify(f.view(f.project.id).dispatches));
});

test('dispatching to a new panel to fill pastes the instruction without a return once the panel first reports Ready', async context => {
  const f = await dispatchable(context, 'dispatch-new-fill');
  await f.holdSessions();
  const creation = await f.workbench.dispatch(f.project.id, { issue: { number: 4, title: 'Fill' }, workflow: 'matt', instruction: 'to-spec', target: { agent: 'claude' }, invert: true });
  const { panel, launch: { run } } = creation!;
  assert.deepEqual((await f.arguments(run.id)).slice(0, 3), ['--echo-bytes', '--hold-session', '--settings'], 'a filled instruction is not a launch argument');
  const filled = paste('/to-spec https://github.com/octo/app/issues/4');
  assert.ok(!f.output(run.id).includes(filled), 'nothing is pasted before Ready');
  await f.start(run.id);
  await until(() => f.output(run.id).includes(`BYTES:${filled}\r\n`), () => f.output(run.id));
  await f.workbench.closePanel(f.project.id, panel.id);
  await until(() => f.view(f.project.id).dispatches.length === 1 && f.view(f.project.id).dispatches[0].location === null,
    () => JSON.stringify(f.view(f.project.id).dispatches));
});

test('a new panel whose Agent exits before reporting a session leaves no dispatch record', async context => {
  const f = await dispatchable(context, 'dispatch-new-exit');
  await f.holdSessions();
  const creation = await f.workbench.dispatch(f.project.id, { issue: { number: 2, title: 'Gone' }, workflow: 'matt', instruction: 'tdd', target: { agent: 'claude' }, invert: false });
  const { launch: { run } } = creation!;
  assert.equal(f.view(f.project.id).dispatches.length, 1);
  await f.request(run.id, { exit: true });
  await until(() => !f.view(f.project.id).tray.length && !f.view(f.project.id).dispatches.length, () => JSON.stringify(f.view(f.project.id)));
  await f.workbench.quit();
  const reopened = await open(context, f.directory);
  assert.deepEqual(reopened.view(f.project.id).dispatches, []);
});

test('a bracketed paste carries text that cannot end the paste early or turn the submitting return into a new line', () => {
  assert.equal(bracketedPaste('/tdd https://github.com/octo/app/issues/1', 'submit'), '\x1b[200~/tdd https://github.com/octo/app/issues/1\x1b[201~\r');
  assert.equal(bracketedPaste('look at\r\nthis\x1b[201~​ now', 'fill'), '\x1b[200~look at\nthis[201~ now\x1b[201~');
  assert.equal(bracketedPaste('ends with \\', 'submit'), '\x1b[200~ends with \\ \x1b[201~\r');
});
