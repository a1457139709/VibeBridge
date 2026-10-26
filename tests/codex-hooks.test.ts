import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { WorkbenchEvent } from '../app/shared/model';

async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for Codex hooks');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function fixture(args: string[] = []) {
  const directory = await mkdtemp(resolve("work/codex-hooks-'$-"));
  let workbench: Workbench;
  try { workbench = await Workbench.open(directory); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const close = async () => { try { await workbench.quit(); } finally { await rm(directory, { recursive: true, force: true }); } };
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.acknowledgeOutput(event.runId, event.data.length);
  });
  const output = (id: string) => events.flatMap(e => e.kind === 'output' && e.runId === id ? [e.data] : []).join('');
  const command = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/codex-hooks.cjs'), ...args] };
  try { await workbench.saveSettings({ agents: { ...workbench.snapshot().settings.agents, codex: command } }); }
  catch (error) { await close(); throw error; }
  let sequence = 0;
  return { workbench, directory, events, output,
    async create(total = 1) {
      const created = await workbench.createProject({ name: 'Codex hooks', directory, total, counts: { codex: total, claude: 0, pi: 0 } });
      for (const { run } of created.launches) await until(() => output(run.id).includes('CODEX-HOOKS-READY'));
      return created;
    },
    async send(runId: string, payload: object, options: object = {}) {
      const id = ++sequence;
      await workbench.sendInput(runId, JSON.stringify({ id, payload, ...options }) + '\n');
      await until(() => output(runId).includes(`ACK:${id}\r\n`));
    },
    close,
  };
}

test('Workbench loads invocation hooks and projects a complete native terminal turn', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    const state = () => f.workbench.snapshot().processing.runs[run.id];
    assert.equal(state(), 'ready');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'turn-1', prompt: 'hello' });
    assert.equal(state(), 'busy');
    await f.send(run.id, { hook_event_name: 'Stop', turn_id: 'turn-1', stop_hook_active: false });
    assert.equal(state(), 'done');
    assert.deepEqual(f.workbench.snapshot().processing.projects[project.id].done,
      { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
    assert.ok(f.output(run.id).includes('ACK:2'), 'native terminal input remains available');
  } finally { await f.close(); }
});

test('native child events and retired sessions cannot change the main run or a parallel panel', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run: first }, { run: second }] } = await f.create(2);
    const state = (id: string) => f.workbench.snapshot().processing.runs[id];
    await f.send(first.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'one' });
    await f.send(second.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'one' });
    await f.send(second.id, { hook_event_name: 'Stop', turn_id: 'one' });
    for (const hook_event_name of ['SubagentStart', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'Stop']) {
      await f.send(first.id, { hook_event_name, agent_id: 'child', agent_type: 'worker', turn_id: 'child-turn' });
      assert.equal(state(first.id), 'busy');
      assert.equal(state(second.id), 'done');
    }
    await f.send(first.id, { hook_event_name: 'SessionEnd' });
    await f.send(first.id, { hook_event_name: 'SessionStart', session_id: 'fresh', source: 'clear' });
    await f.send(first.id, { hook_event_name: 'Stop', turn_id: 'one' });
    assert.equal(state(first.id), 'ready', 'the prior session is no longer associated');
    assert.equal(f.workbench.snapshot().runs.length, 2, 'SessionEnd does not report process exit');
  } finally { await f.close(); }
});

test('permission waits survive unrelated tool activity and end on the matching tool result', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, { turn_id: 'turn', ...payload });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected);
    };
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval', tool_name: 'Bash' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'other', tool_name: 'Bash' }, 'needs-input');
    await check({ hook_event_name: 'PreToolUse', tool_use_id: 'question', tool_name: 'request_user_input_async' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'approval', tool_name: 'Bash', tool_response: { exit_code: 1 } }, 'busy');
    await check({ hook_event_name: 'PreToolUse', tool_use_id: 'retry', tool_name: 'Bash' }, 'busy');
    await check({ hook_event_name: 'Interrupt' }, 'ready');
  } finally { await f.close(); }
});

test('native structured questions wait for the user until their own tool result', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, { turn_id: 'turn', ...payload });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    const ask = (tool_use_id?: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', tool_use_id });
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PreToolUse', tool_use_id: 'async', tool_name: 'request_user_input_async' }, 'busy');
    await check(ask('question'), 'needs-input');
    await check({ hook_event_name: 'PreToolUse', tool_use_id: 'read', tool_name: 'Bash' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'read', tool_name: 'Bash' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'question', tool_name: 'request_user_input' }, 'busy');
    await check(ask(), 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input' }, 'busy');
    await check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval', tool_name: 'Bash' }, 'needs-input');
    await check(ask('both'), 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'both', tool_name: 'request_user_input' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_use_id: 'approval', tool_name: 'Bash' }, 'busy');
    await check({ ...ask('child'), agent_id: 'child', agent_type: 'worker' }, 'busy');
  } finally { await f.close(); }
});

test('native structured question waits end with the turn that asked them', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    const ask = (turn_id: string) => check({ hook_event_name: 'PreToolUse', turn_id, tool_use_id: turn_id, tool_name: 'request_user_input' }, 'needs-input');
    const tool = (turn_id: string) => check({ hook_event_name: 'PreToolUse', turn_id, tool_use_id: `${turn_id}-tool`, tool_name: 'Bash' }, 'busy');
    await check({ hook_event_name: 'UserPromptSubmit', turn_id: 'cancelled' }, 'busy');
    await ask('cancelled');
    await check({ hook_event_name: 'Interrupt', turn_id: 'cancelled' }, 'ready');
    await tool('cancelled');
    await check({ hook_event_name: 'UserPromptSubmit', turn_id: 'stopped' }, 'busy');
    await ask('stopped');
    await check({ hook_event_name: 'Stop', turn_id: 'stopped' }, 'done');
    await tool('stopped');
    await ask('abandoned');
    await tool('replacement');
    await ask('resubmitted');
    await check({ hook_event_name: 'UserPromptSubmit', turn_id: 'resubmitted' }, 'busy');
    await tool('resubmitted');
  } finally { await f.close(); }
});

test('invocation hooks preserve existing hook commands and user launch settings', async () => {
  const args = ['-c=hooks.UserPromptSubmit=[{hooks=[{type="command",command="printf USER-HOOK-RAN"}]}]',
    '-c', 'model="user-selected-model"'];
  const f = await fixture(args);
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'user-hook' });
    assert.ok(f.output(run.id).includes('USER-HOOK-RAN'));
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    assert.deepEqual(f.workbench.snapshot().settings.agents.codex.args.slice(1), args, 'launch additions are never saved into settings');
  } finally { await f.close(); }
});

test('native permission requests without tool identity cannot be resolved by unrelated results', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'turn' });
    await f.send(run.id, { hook_event_name: 'PermissionRequest', turn_id: 'turn', tool_name: 'Bash', tool_input: { command: 'example' } });
    await f.send(run.id, { hook_event_name: 'PostToolUse', turn_id: 'turn', tool_name: 'Bash', tool_use_id: 'other' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'needs-input');
    await f.send(run.id, { hook_event_name: 'Stop', turn_id: 'turn' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
  } finally { await f.close(); }
});

test('closed runs revoke native credentials and late turns cannot overwrite a newer turn', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'old' });
    await f.send(run.id, { hook_event_name: 'Stop', turn_id: 'old' });
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'new' });
    await f.send(run.id, { hook_event_name: 'Stop', turn_id: 'old' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.workbench.sendInput(run.id, JSON.stringify({ id: 'context', context: true }) + '\n');
    await until(() => f.output(run.id).includes('ACK:context'));
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    await f.workbench.closePanel(project.id, run.panelId);
    const fresh = await f.workbench.addPanel(project.id, 'codex');
    const freshRun = fresh.launch.run;
    await until(() => f.workbench.snapshot().processing.runs[freshRun.id] === 'ready');
    const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1,
      scope: 'main', payload: { hook_event_name: 'Stop', session_id: 'late', turn_id: 'old' } }) });
    await response.text();
    assert.equal(response.status, 403);
    assert.equal(f.workbench.snapshot().processing.runs[freshRun.id], 'ready');
    assert.equal(f.workbench.snapshot().processing.projects[project.id].done.count, 0);
  } finally { await f.close(); }
});

test('unreportable native input becomes Error while the terminal and subsequent observations remain usable', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'turn' });
    await f.send(run.id, { hook_event_name: 'PostToolUse', turn_id: 'turn' }, { oversized: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
    await f.send(run.id, { hook_event_name: 'PreToolUse', turn_id: 'turn', tool_name: 'Bash', tool_use_id: 'recovered' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
  } finally { await f.close(); }
});

test('fresh native facts recover after a missed prompt, and same-turn hook continuation returns to Busy', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected);
    };
    await check({ hook_event_name: 'UserPromptSubmit', turn_id: 'first' }, 'busy');
    await check({ hook_event_name: 'Stop', turn_id: 'first' }, 'done');
    await check({ hook_event_name: 'UserPromptSubmit', turn_id: 'first' }, 'busy');
    await check({ hook_event_name: 'Stop', turn_id: 'first' }, 'done');
    await check({ hook_event_name: 'PreToolUse', turn_id: 'next', tool_name: 'Bash', tool_use_id: 'fresh' }, 'busy');
    await check({ hook_event_name: 'Stop', turn_id: 'first' }, 'busy');
  } finally { await f.close(); }
});

test('discarded native child reports cannot consume ordering metadata of the main run', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.workbench.sendInput(run.id, JSON.stringify({ id: 'context', context: true }) + '\n');
    await until(() => f.output(run.id).includes('ACK:context'));
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    const session_id = `session-${run.pid}`;
    const report = async (sequence: number, payload: object) => {
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1,
        scope: 'main', sequence, payload: { session_id, ...payload } }) });
      await response.text(); assert.equal(response.status, 204);
    };
    await report(100, { hook_event_name: 'Stop', agent_id: 'child' });
    await report(10, { hook_event_name: 'UserPromptSubmit', turn_id: 'main' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
  } finally { await f.close(); }
});

test('identity checks apply to every authenticated Codex report, including one from another session', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'main' });
    await f.workbench.sendInput(run.id, JSON.stringify({ id: 'context', context: true }) + '\n');
    await until(() => f.output(run.id).includes('ACK:context'));
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1,
      scope: 'main', payload: { hook_event_name: 'Stop', session_id: 'another', turn_id: 'main' } }) });
    await response.text();
    assert.equal(response.status, 204);
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
  } finally { await f.close(); }
});
