import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './support/pi-extension';
import type { ProcessingState } from '../app/shared/processing-status';

test('pi overlapping manual compactions retain the prior idle result until the last completion', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    for (const prior of ['ready', 'done', 'error'] as const) {
      if (prior !== 'ready') {
        await f.send(run.id, { type: 'agent_start' });
        await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: prior === 'done' ? 'stop' : 'error' } });
        await f.send(run.id, { type: 'agent_settled' });
      }
      const check = async (payload: object, idle: boolean, expected: ProcessingState) => {
        await f.send(run.id, payload, { idle });
        const snapshot = f.workbench.snapshot();
        assert.equal(snapshot.processing.runs[run.id], expected);
        if (expected === 'done' || expected === 'error') assert.deepEqual(snapshot.processing.projects[project.id][expected],
          { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
      };
      // An earlier user extension starts B while handling A's completion.
      // The observer receives B's before-callback before A's completion.
      await check({ type: 'session_before_compact', reason: 'manual' }, false, 'busy');
      await check({ type: 'session_before_compact', reason: 'manual' }, false, 'busy');
      await check({ type: 'session_compact', reason: 'manual', willRetry: false }, false, 'busy');
      await check({ type: 'session_compact', reason: 'manual', willRetry: false }, true, prior);
    }
    assert.ok(f.events.some(event => event.kind === 'snapshot'
      && event.snapshot.processing.projects[project.id]?.done.count === 1));
  } finally { await f.close(); }
});

test('pi manual completion respects pending work and UI waits, and new work supersedes its saved result', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: ProcessingState, options = {}) => {
      await f.send(run.id, payload, options);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected);
    };
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
    await check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'busy', { idle: true, pendingMessages: true });
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
    await check({ type: 'ui_prompt_start' }, 'needs-input');
    await check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'needs-input', { idle: true });
    await check({ type: 'ui_prompt_end' }, 'error');
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy', { idle: false });
    await check({ type: 'session_compact_failed', reason: 'manual', aborted: true, willRetry: false }, 'error', { idle: true });
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'agent_settled' }, 'done');
    for (const reason of ['threshold', 'overflow']) {
      await check({ type: 'session_before_compact', reason, willRetry: true }, 'busy', { idle: false });
      await check({ type: 'session_compact', reason, willRetry: true }, 'busy');
      await check({ type: 'agent_start' }, 'busy');
      await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
      await check({ type: 'agent_settled' }, 'done');
    }
  } finally { await f.close(); }
});

test('pi late manual completion preserves the outcome of a turn started by an earlier completion handler', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { type: 'session_before_compact', reason: 'manual' }, { idle: false });
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_settled' });
    await f.send(run.id, { type: 'session_compact', reason: 'manual', willRetry: false }, { idle: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
  } finally { await f.close(); }
});
