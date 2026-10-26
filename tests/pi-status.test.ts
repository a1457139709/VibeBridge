import test from 'node:test';
import assert from 'node:assert/strict';
import type { Payload } from '../app/main/agent-status/adapter';
import { pi } from '../app/main/agent-status/pi/status';
import type { ProcessingState } from '../app/shared/processing-status';
import { observe } from './support/interpreter';

interface Context { idle?: boolean; pendingMessages?: boolean }

/** A pi run whose session has started. Facts carry the extension context the Status Reporter
 * reads: pi is busy from agent_start until agent_settled unless a fact says otherwise, and
 * agent_end carries the final assistant outcome of its loop.
 */
function started() {
  const accept = observe(pi);
  let idle = true, messages: Payload[] = [];
  const send = (event: Payload, context: Context = {}) => {
    if (context.idle !== undefined) idle = context.idle;
    if (event.type === 'agent_start') { idle = false; messages = []; }
    if (event.type === 'agent_settled') idle = true;
    const payload: Payload = { ...event, isIdle: idle, hasPendingMessages: context.pendingMessages ?? false };
    if (event.type === 'message_end') messages.push(event.message as Payload);
    if (event.type === 'agent_end') payload.finalStopReason = messages.findLast(message => message.role === 'assistant')?.stopReason ?? null;
    return accept(payload);
  };
  send({ type: 'session_start' });
  return (event: Payload, expected: ProcessingState, context?: Context) => assert.equal(send(event, context), expected, JSON.stringify(event));
}
const assistant = (stopReason?: string) => ({ type: 'message_end', message: { role: 'assistant', stopReason } });

test('pi settles only with a final assistant outcome and keeps automatic retries Busy', () => {
  const check = started();
  check({ type: 'session_start' }, 'ready');
  check({ type: 'agent_start' }, 'busy');
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'ui_prompt_end' }, 'busy');
  check({ type: 'tool_execution_end', isError: true }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_end' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'done');
  check({ type: 'agent_start' }, 'busy');
  check({ type: 'agent_settled' }, 'error');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('aborted'), 'busy');
  check({ type: 'agent_settled' }, 'ready');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_settled' }, 'error');
});

test('pi final outcomes require settlement without queued continuation, and retries cannot finish a turn early', () => {
  const check = started();
  check({ type: 'agent_start' }, 'busy');
  check({ type: 'tool_execution_end', isError: true }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_end' }, 'busy');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'busy', { pendingMessages: true });
  check({ type: 'agent_start' }, 'busy');
  check({ type: 'agent_settled' }, 'error');
  for (const [stopReason, expected] of [['stop', 'done'], ['error', 'error'], ['aborted', 'ready'], ['length', 'error'], ['toolUse', 'error']] as const) {
    check({ type: 'agent_start' }, 'busy');
    check(assistant(stopReason), 'busy');
    check({ type: 'agent_end' }, 'busy');
    check({ type: 'agent_settled' }, expected);
  }
});

test('pi session lifecycle facts with pending messages cannot report Ready', () => {
  const check = started();
  for (const type of ['session_start', 'session_switch', 'session_fork', 'session_tree']) check({ type }, 'busy', { pendingMessages: true });
});

test('pi confirmed run cancellation returns Ready even without an aborted assistant message', () => {
  const check = started();
  for (const stopReason of ['error', 'stop', undefined]) {
    check({ type: 'agent_start' }, 'busy');
    if (stopReason) check(assistant(stopReason), 'busy');
    check({ type: 'agent_end' }, 'busy');
    check({ type: 'agent_settled', aborted: true }, 'ready');
  }
});

test('pi cancellation requires no pending work and does not hide extension UI waits or real failure', () => {
  const check = started();
  check({ type: 'agent_start' }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_settled', aborted: true }, 'busy', { pendingMessages: true });
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'agent_settled', aborted: true }, 'needs-input');
  check({ type: 'ui_prompt_end' }, 'ready');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_settled', aborted: false }, 'error');
});

test('pi extension UI waits outlive unrelated tools and restore the latest effective idle or processing fact', () => {
  const check = started();
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'ui_prompt_end' }, 'ready');
  check({ type: 'agent_start' }, 'busy');
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'tool_execution_start' }, 'needs-input');
  check({ type: 'tool_execution_end', isError: true }, 'needs-input');
  check({ type: 'agent_start' }, 'needs-input');
  check({ type: 'ui_prompt_end' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'agent_settled' }, 'needs-input');
  check({ type: 'ui_prompt_end' }, 'done');
});

test('pi recovers from threshold compaction failure within the same agent loop', () => {
  const check = started();
  check({ type: 'agent_start' }, 'busy');
  check(assistant('toolUse'), 'busy');
  check({ type: 'tool_execution_end' }, 'busy');
  check({ type: 'session_before_compact', reason: 'threshold' }, 'busy');
  check({ type: 'session_compact_failed', reason: 'threshold', aborted: false, willRetry: false }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'done');
});

test('pi compaction waits for recovery or final settlement and manual compaction restores the prior idle result', () => {
  const check = started();
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
  check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'ready');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_end' }, 'busy');
  check({ type: 'session_before_compact', reason: 'overflow', willRetry: true }, 'busy');
  check({ type: 'session_compact_failed', reason: 'overflow', willRetry: false }, 'busy');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'done');
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
  check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'done');
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
  check({ type: 'session_compact_failed', reason: 'manual', aborted: false, willRetry: false }, 'error');
  check({ type: 'agent_start' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'session_before_compact', reason: 'threshold' }, 'busy');
  check({ type: 'session_compact_failed', reason: 'threshold', aborted: false }, 'busy');
  check({ type: 'agent_settled' }, 'error');
});

test('pi overlapping manual compactions retain the prior idle result until the last completion', () => {
  const check = started();
  for (const prior of ['ready', 'done', 'error'] as const) {
    if (prior !== 'ready') {
      check({ type: 'agent_start' }, 'busy');
      check(assistant(prior === 'done' ? 'stop' : 'error'), 'busy');
      check({ type: 'agent_settled' }, prior);
    }
    // An earlier user extension starts B while handling A's completion.
    // The observer receives B's before-callback before A's completion.
    check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
    check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
    check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'busy', { idle: false });
    check({ type: 'session_compact', reason: 'manual', willRetry: false }, prior, { idle: true });
  }
});

test('pi manual completion respects pending work and UI waits, and new work supersedes its saved result', () => {
  const check = started();
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
  check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'busy', { idle: true, pendingMessages: true });
  check({ type: 'agent_start' }, 'busy');
  check(assistant('error'), 'busy');
  check({ type: 'agent_settled' }, 'error');
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
  check({ type: 'ui_prompt_start' }, 'needs-input');
  check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'needs-input', { idle: true });
  check({ type: 'ui_prompt_end' }, 'error');
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
  check({ type: 'session_compact_failed', reason: 'manual', aborted: true, willRetry: false }, 'error', { idle: true });
  check({ type: 'agent_start' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'done');
  for (const reason of ['threshold', 'overflow']) {
    check({ type: 'session_before_compact', reason, willRetry: true }, 'busy', { idle: false });
    check({ type: 'session_compact', reason, willRetry: true }, 'busy');
    check({ type: 'agent_start' }, 'busy');
    check(assistant('stop'), 'busy');
    check({ type: 'agent_settled' }, 'done');
  }
});

test('pi late manual completion preserves the outcome of a turn started by an earlier completion handler', () => {
  const check = started();
  check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
  check({ type: 'agent_start' }, 'busy');
  check(assistant('stop'), 'busy');
  check({ type: 'agent_settled' }, 'done');
  check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'done', { idle: true });
});
