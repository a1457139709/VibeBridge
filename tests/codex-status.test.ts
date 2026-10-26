import test from 'node:test';
import assert from 'node:assert/strict';
import type { Payload } from '../app/main/agent-status/adapter';
import { codex } from '../app/main/agent-status/codex/status';
import { observe } from './support/interpreter';

/** A Codex run whose session has started, fed facts as its Status Reporter sends them. */
function started(defaults: Payload = {}) {
  const accept = observe(codex, { session_id: 'session', ...defaults });
  accept({ hook_event_name: 'SessionStart', source: 'startup' });
  return (payload: Payload, expected: string) => assert.equal(accept(payload), expected, JSON.stringify(payload));
}

test('Codex waiting, compaction and native interruption preserve turn semantics', () => {
  const check = started();
  check({ hook_event_name: 'SessionStart', source: 'startup' }, 'ready');
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'shell', tool_use_id: 'approval' }, 'busy');
  check({ hook_event_name: 'PreCompact' }, 'busy');
  check({ hook_event_name: 'SessionStart', source: 'compact' }, 'busy');
  check({ hook_event_name: 'SubagentStop' }, 'busy');
  check({ hook_event_name: 'Interrupt' }, 'busy');
  check({ hook_event_name: 'Interrupt', turn_id: 'turn' }, 'ready');
  check({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', tool_use_id: 'question' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input', tool_use_id: 'question' }, 'busy');
  check({ hook_event_name: 'Stop' }, 'done');
  check({ hook_event_name: 'SessionEnd' }, 'done');
});

test('Codex child events, other sessions and retired sessions cannot change the main run', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'one' }, 'busy');
  for (const hook_event_name of ['SubagentStart', 'PreToolUse', 'PostToolUse', 'SubagentStop', 'Stop']) {
    check({ hook_event_name, agent_id: 'child', agent_type: 'worker', turn_id: 'child-turn' }, 'busy');
  }
  check({ hook_event_name: 'Stop', session_id: 'another', turn_id: 'one' }, 'busy');
  check({ hook_event_name: 'SessionEnd' }, 'busy');
  check({ hook_event_name: 'SessionStart', session_id: 'fresh', source: 'clear' }, 'ready');
  check({ hook_event_name: 'Stop', turn_id: 'one' }, 'ready');
});

test('a Codex report without session identity is Error', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'turn' }, 'busy');
  check({ hook_event_name: 'Stop', session_id: undefined }, 'error');
});

test('Codex permission waits survive unrelated tool activity and end on the matching tool result', () => {
  const check = started({ turn_id: 'turn' });
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval', tool_name: 'Bash' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'other', tool_name: 'Bash' }, 'needs-input');
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'question', tool_name: 'request_user_input_async' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'approval', tool_name: 'Bash' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'retry', tool_name: 'Bash' }, 'busy');
  check({ hook_event_name: 'Interrupt' }, 'ready');
});

test('Codex permission requests without tool identity cannot be resolved by unrelated results', () => {
  const check = started({ turn_id: 'turn' });
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'other' }, 'needs-input');
  check({ hook_event_name: 'Stop' }, 'done');
});

test('Codex structured questions wait for the user until their own tool result', () => {
  const check = started({ turn_id: 'turn' });
  const ask = (tool_use_id?: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'request_user_input', tool_use_id });
  check({ hook_event_name: 'UserPromptSubmit' }, 'busy');
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'async', tool_name: 'request_user_input_async' }, 'busy');
  check(ask('question'), 'needs-input');
  check({ hook_event_name: 'PreToolUse', tool_use_id: 'read', tool_name: 'Bash' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'read', tool_name: 'Bash' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'question', tool_name: 'request_user_input' }, 'busy');
  check(ask(), 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_name: 'request_user_input' }, 'busy');
  check({ hook_event_name: 'PermissionRequest', tool_use_id: 'approval', tool_name: 'Bash' }, 'needs-input');
  check(ask('both'), 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'both', tool_name: 'request_user_input' }, 'needs-input');
  check({ hook_event_name: 'PostToolUse', tool_use_id: 'approval', tool_name: 'Bash' }, 'busy');
  check({ ...ask('child'), agent_id: 'child', agent_type: 'worker' }, 'busy');
});

test('Codex structured question waits end with the turn that asked them', () => {
  const check = started();
  const ask = (turn_id: string) => check({ hook_event_name: 'PreToolUse', turn_id, tool_use_id: turn_id, tool_name: 'request_user_input' }, 'needs-input');
  const tool = (turn_id: string) => check({ hook_event_name: 'PreToolUse', turn_id, tool_use_id: `${turn_id}-tool`, tool_name: 'Bash' }, 'busy');
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'cancelled' }, 'busy');
  ask('cancelled');
  check({ hook_event_name: 'Interrupt', turn_id: 'cancelled' }, 'ready');
  tool('cancelled');
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'stopped' }, 'busy');
  ask('stopped');
  check({ hook_event_name: 'Stop', turn_id: 'stopped' }, 'done');
  tool('stopped');
  ask('abandoned');
  tool('replacement');
  ask('resubmitted');
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'resubmitted' }, 'busy');
  tool('resubmitted');
});

test('late Codex turns cannot overwrite a newer turn', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'old' }, 'busy');
  check({ hook_event_name: 'Stop', turn_id: 'old' }, 'done');
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'new' }, 'busy');
  check({ hook_event_name: 'Stop', turn_id: 'old' }, 'busy');
});

test('fresh Codex facts recover after a missed prompt, and same-turn hook continuation returns to Busy', () => {
  const check = started();
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'first' }, 'busy');
  check({ hook_event_name: 'Stop', turn_id: 'first' }, 'done');
  check({ hook_event_name: 'UserPromptSubmit', turn_id: 'first' }, 'busy');
  check({ hook_event_name: 'Stop', turn_id: 'first' }, 'done');
  check({ hook_event_name: 'PreToolUse', turn_id: 'next', tool_name: 'Bash', tool_use_id: 'fresh' }, 'busy');
  check({ hook_event_name: 'Stop', turn_id: 'first' }, 'busy');
});
