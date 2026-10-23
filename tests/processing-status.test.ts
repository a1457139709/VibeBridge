import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { AgentType, WorkbenchEvent } from '../app/shared/model';

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
    const state = () => f.workbench.snapshot().processing.runs[run.id];
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
    assert.deepEqual(f.workbench.snapshot().processing.projects[project.id].done,
      { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
    const snapshots = f.events.flatMap(event => event.kind === 'snapshot' ? [event.snapshot] : []);
    assert.ok(snapshots.some(snapshot => snapshot.projects.some(item => item.id === project.id) && !snapshot.runs.length && !Object.keys(snapshot.processing.runs).length));
    for (const snapshot of snapshots) {
      const done = snapshot.processing.projects[project.id]?.done;
      if (done) assert.equal(done.count, snapshot.runs.filter(run => snapshot.processing.runs[run.id] === 'done').length);
    }
  } finally { await f.close(); }
});

test('current-run validation discards unrelated, child, stale, duplicate and expired reports before classification', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run: first }, { run: second }] } = await f.create('codex', 2);
    const state = (id: string) => f.workbench.snapshot().processing.runs[id];
    await f.send(first.id, { payload: { hook_event_name: 'Stop', session_id: 'shared' }, overrides: { sequence: 10, id: 'completion' } });
    await f.send(second.id, { payload: { hook_event_name: 'UserPromptSubmit', session_id: 'shared' } });
    assert.equal(state(first.id), 'done'); assert.equal(state(second.id), 'busy');
    const before = f.events.filter(event => event.kind === 'snapshot').length;
    for (const overrides of [
      { runId: second.id }, { token: 'wrong' }, { agent: 'pi' }, { scope: 'child', sequence: 1000 },
      { sequence: 9 }, { sequence: 10 }, { sequence: 11, id: 'completion' },
      { sequence: 11, occurredAt: 1 }, { sequence: 11, expiresAt: 1 },
    ]) await f.send(first.id, { payload: { hook_event_name: 'unclassified' }, overrides });
    assert.equal(state(first.id), 'done'); assert.equal(state(second.id), 'busy');
    assert.equal(f.events.filter(event => event.kind === 'snapshot').length, before, 'discarded reports publish no false transition');
    await f.send(first.id, { payload: { hook_event_name: 'unclassified' }, overrides: { sequence: 11 } });
    assert.equal(state(first.id), 'error', 'a current, valid but unmapped event is Error');
    await f.send(first.id, { payload: { hook_event_name: 'UserPromptSubmit' }, overrides: { sequence: 12 } });
    assert.equal(state(first.id), 'busy', 'discarded child sequence did not poison main-run ordering');
  } finally { await f.close(); }
});

test('source timestamps reject identifiable late reports even when no sequence is available', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const earlier = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5));
    await f.send(run.id, { unsequenced: true, payload: { hook_event_name: 'Stop' }, overrides: { occurredAt: Date.now() } });
    await f.send(run.id, { unsequenced: true, payload: { hook_event_name: 'Unclassified' }, overrides: { occurredAt: earlier } });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
  } finally { await f.close(); }
});

test('malformed scope cannot masquerade as a main event or consume its sequence', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { payload: { hook_event_name: 'Stop' } });
    for (const scope of [['child'], ['main'], null, 1]) {
      await f.send(run.id, { payload: { hook_event_name: 'Unclassified' }, overrides: { scope, sequence: 1000 } });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
    }
    await f.send(run.id, { payload: { hook_event_name: 'UserPromptSubmit' } });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
  } finally { await f.close(); }
});

test('Codex waiting, tool failures, compaction and confirmed interruption preserve turn semantics', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, { payload });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ hook_event_name: 'SessionStart', source: 'startup' }, 'ready');
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUseFailure', tool_name: 'shell', tool_use_id: 'approval' }, 'busy');
    await check({ hook_event_name: 'PreCompact' }, 'busy');
    await check({ hook_event_name: 'SessionStart', source: 'compact' }, 'busy');
    await check({ hook_event_name: 'SubagentStop' }, 'busy');
    await check({ hook_event_name: 'Interrupt' }, 'busy');
    await check({ hook_event_name: 'Interrupt', confirmed: true, can_accept_input: true }, 'ready');
    await check({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', blocking: true }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input' }, 'busy');
    await check({ hook_event_name: 'Stop' }, 'done');
    await check({ hook_event_name: 'SessionEnd' }, 'done');
  } finally { await f.close(); }
});

test('Claude separates blocking input and individual tool failure from a failed main turn', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create('claude');
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, { payload });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ hook_event_name: 'SessionStart' }, 'ready');
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion' }, 'busy');
    await check({ hook_event_name: 'Elicitation' }, 'needs-input');
    await check({ hook_event_name: 'ElicitationResult' }, 'busy');
    await check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUseFailure', tool_use_id: 'approval' }, 'busy');
    await check({ hook_event_name: 'PreCompact' }, 'busy');
    await check({ hook_event_name: 'SubagentStop' }, 'busy');
    await check({ hook_event_name: 'StopFailure' }, 'error');
    await check({ hook_event_name: 'Notification' }, 'error');
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'Stop' }, 'done');
  } finally { await f.close(); }
});

test('pi settles only with a final assistant outcome and keeps automatic retries Busy', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create('pi');
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, { payload });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ type: 'session_start' }, 'ready');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'ui_prompt_start' }, 'needs-input');
    await check({ type: 'ui_prompt_end' }, 'busy');
    await check({ type: 'tool_execution_end', isError: true }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }, 'busy');
    await check({ type: 'agent_end' }, 'busy');
    await check({ type: 'auto_retry_start' }, 'busy');
    await check({ type: 'auto_retry_end', success: true }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'agent_settled' }, 'done');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'aborted' } }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'aborted' } }, 'busy');
    await check({ type: 'agent_settled', isIdle: true, hasPendingMessages: false }, 'ready');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
  } finally { await f.close(); }
});

test('observation loss leaves a usable terminal and recovery requires fresh reliable facts', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create('pi');
    const state = () => f.workbench.snapshot().processing.runs[run.id];
    assert.equal(state(), 'error', 'running without an initial observation cannot establish a processing state');
    await f.send(run.id, { payload: { type: 'agent_start' } });
    await f.send(run.id, { payload: { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } } });
    await f.send(run.id, { payload: { observation: 'lost' } });
    assert.equal(state(), 'error');
    await f.send(run.id, { payload: { observation: 'restored' }, output: 'terminal still accepts input' });
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
    for (const run of [first, second]) await f.send(run.id, { payload: { hook_event_name: 'Stop', session_id: 'shared' } });
    await f.send(third.id, { payload: { hook_event_name: 'PermissionRequest' } });
    const background = join(f.directory, 'background'); await mkdir(background);
    const other = await f.create('codex', 1, background);
    await f.send(other.launches[0].run.id, { payload: { hook_event_name: 'Unclassified' } });
    const groups = () => f.workbench.snapshot().processing.projects[project.id];
    assert.deepEqual(groups().done, { count: 2, members: [first, second].map(run => ({ panelId: run.panelId, runId: run.id })) });
    assert.equal(groups()['needs-input'].count, 1);
    assert.equal(f.workbench.snapshot().processing.projects[other.project.id].error.count, 1);
    await f.send(first.id, { payload: { hook_event_name: 'UserPromptSubmit' } });
    assert.equal(f.workbench.snapshot().activeProjectId, other.project.id);
    assert.equal(groups().done.count, 1, 'background membership continues updating');
    for (const [run, code] of [[first, 0], [second, 2]] as const) {
      await f.workbench.sendInput(run.id, JSON.stringify({ exit: code }) + '\n');
      await until(() => !f.workbench.snapshot().projects.find(p => p.id === project.id)!.panels.some(p => p.id === run.panelId));
      assert.equal(f.workbench.snapshot().processing.runs[run.id], undefined);
    }
    await f.workbench.closePanel(project.id, third.panelId);
    assert.deepEqual(groups(), { 'needs-input': { count: 0, members: [] }, done: { count: 0, members: [] }, error: { count: 0, members: [] } });
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(reopened.snapshot().processing.runs, {});
      assert.equal(reopened.snapshot().processing.projects[other.project.id].error.count, 0);
      assert.deepEqual(reopened.snapshot().projects.find(p => p.id === other.project.id)!.panels, other.project.panels);
      await reopened.activateProject(other.project.id);
      const fresh = reopened.snapshot().runs[0];
      assert.notEqual(fresh.id, other.launches[0].run.id);
      assert.equal(reopened.snapshot().processing.runs[fresh.id], 'error');
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
    assert.equal(f.workbench.snapshot().processing.runs[fresh.id], 'error');
    await f.send(fresh.id, { payload: { hook_event_name: 'SessionStart', source: 'startup' } });
    const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1, scope: 'main', payload: { hook_event_name: 'Unclassified' } }) });
    await response.text();
    assert.equal(response.status, 403);
    assert.equal(f.workbench.snapshot().processing.runs[fresh.id], 'ready');
    await f.workbench.closePanel(project.id, fresh.panelId);
    assert.deepEqual(f.workbench.snapshot().processing.runs, {});
  } finally { await f.close(); }
});

test('launch failures use launch feedback and contribute no processing state or attention count', async () => {
  const f = await fixture();
  try {
    await f.workbench.saveSettings({ agents: { ...f.workbench.snapshot().settings.agents, codex: { command: join(f.directory, 'missing-cli'), args: [] } } });
    const result = await f.workbench.createProject({ name: 'Launch failure', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    assert.equal(result.launches[0].ok, false);
    assert.equal(result.launches[0].ok ? '' : result.launches[0].error, 'Agent 无法启动');
    assert.deepEqual(f.workbench.snapshot().processing.runs, {});
    assert.equal(f.workbench.snapshot().processing.projects[result.project.id].error.count, 0);
  } finally { await f.close(); }
});
