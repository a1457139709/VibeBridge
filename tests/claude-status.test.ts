import test from 'node:test';
import assert from 'node:assert/strict';
import { claude } from '../app/main/agent-status/claude/status';
import type { Payload } from '../app/main/agent-status/adapter';

/** Feeds payloads the way ProcessingStatus does: every Error discards outcome evidence. */
function observe() {
  const interpreter = claude.observe();
  return (payload: Payload) => {
    const outcome = interpreter.accept({ session_id: 'session', ...payload });
    if (outcome === 'error') interpreter.discardEvidence();
    return outcome;
  };
}

test('an Error discards tools in progress, so a later permission request matches only tools started after it', () => {
  const accept = observe();
  accept({ hook_event_name: 'UserPromptSubmit' });
  accept({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'before', tool_input_hash: 'same' });
  assert.equal(accept({ hook_event_name: 'Unclassified' }), 'error');
  accept({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'after', tool_input_hash: 'same' });
  assert.equal(accept({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input_hash: 'same' }), 'needs-input');
  assert.equal(accept({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'before', tool_input_hash: 'same' }), 'needs-input',
    'the result of a tool from before the Error cannot answer the new request');
  assert.equal(accept({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'after', tool_input_hash: 'same' }), 'busy');
});
