import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/claude-hooks';

test('Claude invocation hooks project a native terminal turn and consistent Workbench subscriptions', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'ready');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { hook_event_name: 'Stop' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
    await f.send(run.id, {}, { output: 'terminal remains usable' });
    assert.ok(f.output(run.id).includes('terminal remains usable'));
    for (const event of f.events) if (event.kind === 'snapshot' && event.snapshot.processing.runs[run.id] === 'done') {
      assert.deepEqual(event.snapshot.processing.projects[project.id].done,
        { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
    }
  } finally { await f.close(); }
});

test('Claude waits survive unrelated tools and resolve only with matching results or a new main-turn fact', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' }, 'needs-input');
    await check({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_use_id: 'read' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'read' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' }, 'busy');
    await check({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'approved', tool_input: { command: 'printf approved', description: 'waiting' } }, 'busy');
    await check({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'printf approved', description: 'waiting' } }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'other', tool_input: { command: 'pwd' } }, 'needs-input');
    await check({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'approved', tool_input: { description: 'waiting', command: 'printf approved' } }, 'busy');
    await check({ hook_event_name: 'Elicitation', mcp_server_name: 'forms', elicitation_id: 'one' }, 'needs-input');
    await check({ hook_event_name: 'Elicitation', mcp_server_name: 'forms', elicitation_id: 'two' }, 'needs-input');
    await check({ hook_event_name: 'ElicitationResult', mcp_server_name: 'forms', elicitation_id: 'one' }, 'needs-input');
    await check({ hook_event_name: 'PreCompact' }, 'needs-input');
    await check({ hook_event_name: 'ElicitationResult', mcp_server_name: 'forms', elicitation_id: 'two' }, 'busy');
    await check({ hook_event_name: 'PostCompact' }, 'busy');
    await check({ hook_event_name: 'SessionStart', source: 'compact' }, 'busy');
    await check({ hook_event_name: 'PostToolUseFailure', tool_use_id: 'failed' }, 'busy');
    await check({ hook_event_name: 'StopFailure' }, 'error');
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'PermissionRequest' }, 'needs-input');
    await check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'unrelated' }, 'needs-input');
    await check({ hook_event_name: 'Stop' }, 'done');
    await check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
    await check({ hook_event_name: 'Stop' }, 'done');
  } finally { await f.close(); }
});

test('indistinguishable concurrent Claude permission requests stay waiting until a main-turn fact resolves them', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const tool = { tool_name: 'Bash', tool_input: { command: 'pwd' } };
    await f.send(run.id, { hook_event_name: 'PreToolUse', tool_use_id: 'one', ...tool });
    await f.send(run.id, { hook_event_name: 'PreToolUse', tool_use_id: 'two', ...tool });
    await f.send(run.id, { hook_event_name: 'PermissionRequest', ...tool });
    await f.send(run.id, { hook_event_name: 'PostToolUse', tool_use_id: 'one', ...tool });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'needs-input');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
  } finally { await f.close(); }
});

test('replayed Claude prompt and elicitation identities cannot reopen completed work', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const prompt = { hook_event_name: 'UserPromptSubmit', prompt_id: 'prompt' };
    await f.send(run.id, prompt);
    await f.send(run.id, { hook_event_name: 'Stop', prompt_id: 'prompt' });
    await f.send(run.id, prompt);
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
    const elicitation = { mcp_server_name: 'forms', elicitation_id: 'request', prompt_id: 'next' };
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit', prompt_id: 'next' });
    await f.send(run.id, { hook_event_name: 'Elicitation', ...elicitation });
    await f.send(run.id, { hook_event_name: 'ElicitationResult', ...elicitation });
    await f.send(run.id, { hook_event_name: 'Elicitation', ...elicitation });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { hook_event_name: 'Stop', prompt_id: 'next' });
    await f.send(run.id, { hook_event_name: 'ElicitationResult', ...elicitation });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
  } finally { await f.close(); }
});

test('Claude child activity and identifiable old session, prompt and tool events cannot contaminate parallel runs', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run: first }, { run: second }] } = await f.create(2);
    const check = async (payload: object, expected = 'busy') => {
      await f.send(first.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[first.id], expected, JSON.stringify(payload));
      assert.equal(f.workbench.snapshot().processing.runs[second.id], 'ready');
    };
    await check({ hook_event_name: 'SessionStart', source: 'clear', session_id: 'current' }, 'ready');
    await check({ hook_event_name: 'UserPromptSubmit', session_id: 'current', prompt_id: 'old' });
    await check({ hook_event_name: 'UserPromptSubmit', session_id: 'current', prompt_id: 'new' });
    await check({ hook_event_name: 'Stop', session_id: 'current', agent_id: 'child' });
    await check({ hook_event_name: 'StopFailure', session_id: 'current', agent_id: 'child' });
    await check({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', agent_id: 'child', session_id: 'current' });
    await check({ hook_event_name: 'SubagentStop', session_id: 'current' });
    await check({ hook_event_name: 'Stop', session_id: 'current', prompt_id: 'old' });
    await check({ hook_event_name: 'PostToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' });
    await check({ hook_event_name: 'Stop', session_id: 'current', prompt_id: 'new' }, 'done');
    await check({ hook_event_name: 'PostToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' }, 'done');
    await check({ hook_event_name: 'PreToolUse', session_id: 'current', prompt_id: 'new', tool_use_id: 'tool' }, 'done');
    await check({ hook_event_name: 'SessionStart', session_id: 'fresh', source: 'clear' }, 'ready');
    await check({ hook_event_name: 'Stop', session_id: 'current' }, 'ready');
    await check({ hook_event_name: 'SessionStart', session_id: 'current', source: 'startup' }, 'ready');
  } finally { await f.close(); }
});
