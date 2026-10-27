import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/cli-double';
import { showing } from './support/panel-views';

test('Codex loads the session hooks and its reporter projects a native terminal turn', async () => {
  const f = await fixture('codex');
  try {
    const { project, launches: [{ run }] } = await f.create();
    assert.equal(f.state(run.id), 'ready');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'turn-1', prompt: 'hello' });
    assert.equal(f.state(run.id), 'busy');
    await f.send(run.id, { hook_event_name: 'Stop', turn_id: 'turn-1', stop_hook_active: false });
    assert.equal(f.state(run.id), 'done');
    assert.deepEqual(showing(f.workbench.snapshot(), project.id, 'done'),
      [[run.panelId, run.id]]);
    assert.ok(f.output(run.id).includes('ACK:2'), 'native terminal input remains available');
  } finally { await f.close(); }
});

test('Codex keeps existing hook commands and user launch settings beside the reporter', async () => {
  const args = ['-c=hooks.UserPromptSubmit=[{hooks=[{type="command",command="printf USER-HOOK-RAN"}]}]',
    '-c', 'model="user-selected-model"'];
  const f = await fixture('codex', args);
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'user-hook' });
    assert.ok(f.output(run.id).includes('USER-HOOK-RAN'));
    assert.equal(f.state(run.id), 'busy');
    assert.deepEqual(f.workbench.snapshot().settings.agents.codex.args.slice(1), args, 'launch additions are never saved into settings');
  } finally { await f.close(); }
});

test('hook input the reporter cannot send becomes Error while the terminal and later observations remain usable', async () => {
  const f = await fixture('codex');
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', turn_id: 'turn' });
    await f.send(run.id, { hook_event_name: 'PostToolUse', turn_id: 'turn' }, { oversized: true });
    assert.equal(f.state(run.id), 'error');
    await f.send(run.id, { hook_event_name: 'PreToolUse', turn_id: 'turn', tool_name: 'Bash', tool_use_id: 'recovered' });
    assert.equal(f.state(run.id), 'busy');
  } finally { await f.close(); }
});
