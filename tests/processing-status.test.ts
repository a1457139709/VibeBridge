import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { AgentType, Run, WorkbenchEvent } from '../app/shared/model';
import type { ProcessingState } from '../app/shared/processing-status';
import { panelViews, runsOf, showing, statusOf, storedProjects } from './support/panel-views';

async function until(check: () => boolean) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for status CLI');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function fixture() {
  const directory = await mkdtemp(resolve('work/processing-status-'));
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.acknowledgeOutput(event.runId, event.data.length);
  });
  const command = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/status-cli.cjs')] };
  await workbench.saveSettings({ agents: { codex: command, claude: command, pi: command } });
  const output = (runId: string) => events.flatMap(event => event.kind === 'output' && event.runId === runId ? [event.data] : []).join('');
  let next = 0;
  return { directory, workbench, events, output,
    async create(agent: AgentType = 'codex', total = 1, path = directory) {
      const result = await workbench.createProject({ name: 'Processing status', directory: path, total,
        counts: { codex: 0, claude: 0, pi: 0, [agent]: total } });
      for (const launch of result.launches) await until(() => output(launch.run.id).includes('STATUS-CLI-READY'));
      return result;
    },
    async send(runId: string, message: object) {
      const id = String(++next);
      await workbench.sendInput(runId, JSON.stringify({ ...message, id }) + '\n');
      await until(() => output(runId).includes(`ACK:${id}\r\n`));
    },
    close: async () => { await workbench.quit(); await rm(directory, { recursive: true, force: true }); },
  };
}

test('official reports drive Ready, Busy and Done while terminal activity preserves the result', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    const state = () => statusOf(f.workbench.snapshot(), run.id);
    await f.send(run.id, { payload: { hook_event_name: 'SessionStart', source: 'startup' } });
    assert.equal(state(), 'ready');
    await f.send(run.id, { payload: { hook_event_name: 'UserPromptSubmit' } });
    assert.equal(state(), 'busy');
    await f.send(run.id, { payload: { hook_event_name: 'Stop' } });
    assert.equal(state(), 'done');
    await f.send(run.id, { output: 'Busy? Error?\u001b]2;Working\u0007' });
    assert.equal(state(), 'done');
    await f.workbench.activateProject(project.id);
    assert.equal(state(), 'done');
    assert.deepEqual(showing(f.workbench.snapshot(), project.id, 'done'),
      [[run.panelId, run.id]]);
    const snapshots = f.events.flatMap(event => event.kind === 'snapshot' ? [event.snapshot] : []);
    assert.ok(snapshots.some(snapshot => snapshot.projects.find(item => item.id === project.id)?.panels.every(panel => !panel.run && !panel.status)),
      'the project is published before its run starts, without a processing state');
  } finally { await f.close(); }
});

test('only the launch credentials associate a report, and rejected reports publish nothing', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run: first }, { run: second }] } = await f.create('codex', 2);
    const state = (id: string) => statusOf(f.workbench.snapshot(), id);
    // Both runs report the same CLI session identity; only launch credentials associate a report.
    await f.send(first.id, { payload: { hook_event_name: 'Stop' } });
    await f.send(second.id, { payload: { hook_event_name: 'UserPromptSubmit' } });
    assert.equal(state(first.id), 'done'); assert.equal(state(second.id), 'busy');
    const before = f.events.filter(event => event.kind === 'snapshot').length;
    for (const overrides of [{ runId: second.id }, { token: 'wrong' }, { agent: 'pi' }, { payload: [] }]) {
      await f.send(first.id, { payload: { hook_event_name: 'unclassified' }, overrides });
    }
    await f.send(first.id, { payload: { observation: 'restored' } });
    assert.equal(state(first.id), 'done'); assert.equal(state(second.id), 'busy');
    assert.equal(f.events.filter(event => event.kind === 'snapshot').length, before, 'rejected reports publish no false transition');
    await f.send(first.id, { payload: { hook_event_name: 'unclassified' } });
    assert.equal(state(first.id), 'error', 'a current, valid but unmapped event is Error');
  } finally { await f.close(); }
});

test('a launch configuration that cannot be safely extended starts the original command, observed as Error', async () => {
  const f = await fixture();
  try {
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/status-cli.cjs'), '-c', 'hooks=1'] };
    await f.workbench.saveSettings({ agents: { ...f.workbench.snapshot().settings.agents, codex: command } });
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { context: true, payload: { hook_event_name: 'UserPromptSubmit' }, output: 'still interactive' });
    assert.ok(f.output(run.id).includes('CONTEXT:{}'), 'no reporting credentials are issued');
    assert.ok(f.output(run.id).includes('still interactive'));
    assert.equal(statusOf(f.workbench.snapshot(), run.id), 'error');
  } finally { await f.close(); }
});

test('observation loss leaves a usable terminal and recovery requires fresh reliable facts', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create('pi');
    const state = () => statusOf(f.workbench.snapshot(), run.id);
    assert.equal(state(), 'error', 'running without an initial observation cannot establish a processing state');
    await f.send(run.id, { payload: { type: 'agent_start' } });
    await f.send(run.id, { payload: { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } } });
    await f.send(run.id, { payload: { observation: 'lost' } });
    assert.equal(state(), 'error');
    await f.send(run.id, { output: 'terminal still accepts input' });
    assert.ok(f.output(run.id).includes('terminal still accepts input'));
    assert.equal(state(), 'error');
    await f.send(run.id, { payload: { type: 'agent_settled' } });
    assert.equal(state(), 'error', 'recovery does not reuse an outcome from before observation was lost');
    await f.send(run.id, { payload: { type: 'agent_start' } });
    assert.equal(state(), 'busy');
    await f.send(run.id, { payload: { observation: 'unavailable' } });
    assert.equal(state(), 'error');
    await f.send(run.id, { output: 'Ready Busy Done' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(state(), 'error', 'silence, liveness and output do not restore a previous status');
  } finally { await f.close(); }
});

test('background panels retain independent memberships, exits remove them, and quitting preserves only configuration', async () => {
  const f = await fixture();
  try {
    const { project, launches } = await f.create('codex', 3);
    const [first, second, third] = launches.map(launch => launch.run);
    const showingIn = (state: ProcessingState) => showing(f.workbench.snapshot(), project.id, state);
    const pairs = (...runs: Run[]) => runs.map(run => [run.panelId, run.id]);
    for (const run of launches.map(launch => launch.run)) await f.send(run.id, { payload: { hook_event_name: 'SessionStart', source: 'startup' } });
    assert.deepEqual(showingIn('ready'), pairs(first, second, third),
      'fresh runs are listed as Ready before they accept a turn');
    for (const run of [first, second]) await f.send(run.id, { payload: { hook_event_name: 'Stop' } });
    await f.send(third.id, { payload: { hook_event_name: 'PermissionRequest' } });
    const background = join(f.directory, 'background'); await mkdir(background);
    const other = await f.create('codex', 1, background);
    await f.send(other.launches[0].run.id, { payload: { hook_event_name: 'Unclassified' } });
    assert.deepEqual(showingIn('ready'), []);
    assert.deepEqual(showingIn('done'), pairs(first, second));
    assert.deepEqual(showingIn('needs-input'), pairs(third));
    assert.deepEqual(showing(f.workbench.snapshot(), other.project.id, 'error'), pairs(other.launches[0].run));
    await f.send(first.id, { payload: { hook_event_name: 'UserPromptSubmit' } });
    assert.equal(f.workbench.snapshot().activeProjectId, other.project.id);
    assert.deepEqual(showingIn('done'), pairs(second), 'background membership continues updating');
    await f.send(second.id, { payload: { hook_event_name: 'PreToolUse', tool_name: 'request_user_input' } });
    assert.deepEqual(showingIn('needs-input'), pairs(second, third));
    for (const [run, code] of [[first, 0], [second, 2]] as const) {
      await f.workbench.sendInput(run.id, JSON.stringify({ exit: code }) + '\n');
      await until(() => !f.workbench.snapshot().projects.find(p => p.id === project.id)!.panels.some(p => p.id === run.panelId));
      assert.equal(statusOf(f.workbench.snapshot(), run.id), undefined);
    }
    await f.workbench.closePanel(project.id, third.panelId);
    assert.ok(f.workbench.snapshot().projects.find(p => p.id === project.id)!.panels.every(panel => !panel.status));
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.ok(panelViews(reopened.snapshot()).every(panel => !panel.run && !panel.status));
      assert.deepEqual(storedProjects(reopened.snapshot()).find(p => p.id === other.project.id)!.panels, other.project.panels);
      await reopened.activateProject(other.project.id);
      const fresh = runsOf(reopened.snapshot())[0];
      assert.notEqual(fresh.id, other.launches[0].run.id);
      assert.equal(statusOf(reopened.snapshot(), fresh.id), 'error');
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('restarting a panel revokes old report credentials and never inherits Done', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    await f.send(run.id, { context: true, payload: { hook_event_name: 'Stop' } });
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    const target = join(f.directory, 'restart'); await mkdir(target);
    const result = await f.workbench.editProject(project.id, { name: project.name, directory: target }, true);
    const fresh = result.launches[0].run;
    await until(() => f.output(fresh.id).includes('STATUS-CLI-READY'));
    assert.notEqual(fresh.id, run.id); assert.equal(fresh.panelId, run.panelId);
    assert.equal(statusOf(f.workbench.snapshot(), fresh.id), 'error');
    await f.send(fresh.id, { payload: { hook_event_name: 'SessionStart', source: 'startup' } });
    const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, payload: { hook_event_name: 'Unclassified' } }) });
    await response.text();
    assert.equal(response.status, 403);
    assert.equal(statusOf(f.workbench.snapshot(), fresh.id), 'ready');
    await f.workbench.closePanel(project.id, fresh.panelId);
    assert.deepEqual(panelViews(f.workbench.snapshot()), []);
  } finally { await f.close(); }
});

test('launch failures use launch feedback and contribute no processing state or attention count', async () => {
  const f = await fixture();
  try {
    await f.workbench.saveSettings({ agents: { ...f.workbench.snapshot().settings.agents, codex: { command: join(f.directory, 'missing-cli'), args: [] } } });
    const result = await f.workbench.createProject({ name: 'Launch failure', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    assert.equal(result.launches[0].outcome, 'failed');
    assert.ok(panelViews(f.workbench.snapshot()).every(panel => !panel.status));
  } finally { await f.close(); }
});
