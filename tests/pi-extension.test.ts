import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, until } from './support/pi-extension';

test('pi invocation extension projects a terminal turn and consistent Workbench subscriptions', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'ready');
    await f.send(run.id, { type: 'agent_start' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_end' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { type: 'agent_settled' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
    await f.send(run.id, undefined, { output: 'native terminal remains usable' });
    assert.ok(f.output(run.id).includes('native terminal remains usable'));
    const snapshots = f.events.flatMap(e => e.kind === 'snapshot' && e.snapshot.processing.runs[run.id] === 'done' ? [e.snapshot] : []);
    assert.ok(snapshots.length);
    for (const snapshot of snapshots) assert.deepEqual(snapshot.processing.projects[project.id].done,
      { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
  } finally { await f.close(); }
});

test('pi settlement uses the final assistant outcome after existing extensions replace a message', async () => {
  const f = await fixture(['--discovered-extension', './rewrite.mjs']);
  try {
    await writeFile(join(f.directory, 'rewrite.mjs'), `export default pi => {
      pi.on('message_end', async event => event.message.role === 'assistant'
        ? { message: { ...event.message, stopReason: 'error' } } : undefined);
    };`);
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_end' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { type: 'agent_settled' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
  } finally { await f.close(); }
});

test('pi recovers from threshold compaction failure within the same agent loop', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse' } });
    await f.send(run.id, { type: 'tool_execution_end' });
    await f.send(run.id, { type: 'session_before_compact', reason: 'threshold' });
    await f.send(run.id, { type: 'session_compact_failed', reason: 'threshold', aborted: false, willRetry: false });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_settled' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'done');
  } finally { await f.close(); }
});

test('pi session lifecycle facts with pending messages cannot report Ready', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    for (const type of ['session_start', 'session_switch', 'session_fork', 'session_tree']) {
      await f.send(run.id, { type }, { pendingMessages: true });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy', type);
    }
  } finally { await f.close(); }
});

test('pi preserves explicit extensions and arguments, and reload retains the source ordering', async () => {
  const f = await fixture(['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
  try {
    const source = `export default pi => { pi.on('session_start', async () => { console.log('EXISTING_EXTENSION_OK'); }); };`;
    await writeFile(join(f.directory, 'existing.mjs'), source);
    // The CLI resolves user paths relative to its project, just as pi does.
    const { launches: [{ run }] } = await f.create();
    assert.ok(f.output(run.id).includes('EXISTING_EXTENSION_OK'));
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_settled' });
    await f.send(run.id, undefined, { reload: true, arguments: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'ready');
    await f.send(run.id, { type: 'agent_start' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    assert.equal(await readFile(join(f.directory, 'existing.mjs'), 'utf8'), source);
    const args: string[] = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]);
    assert.deepEqual(args.slice(0, 3), ['--no-extensions', '-e', './existing.mjs']);
    assert.deepEqual(args.slice(-2), ['--', 'literal --extension']);
    assert.deepEqual(f.workbench.snapshot().settings.agents.pi.args.slice(1), ['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
  } finally { await f.close(); }
});

test('pi parallel runs and replacement runs reject child, stale and retired launch reports', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }, { run: other }] } = await f.create(2);
    await f.send(run.id, { type: 'agent_start' }, { context: true });
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    const post = async (overrides: object = {}) => {
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1,
        source: 'pi-extension', scope: 'main', payload: { type: 'session_start' }, ...overrides }) });
      await response.text(); return response.status;
    };
    for (const overrides of [{ scope: 'child', sequence: 1000 }, { sequence: 0 }, { runId: other.id }, { occurredAt: 1 }, { expiresAt: 1 }]) {
      await post(overrides);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
      assert.equal(f.workbench.snapshot().processing.runs[other.id], 'ready');
    }
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_settled' });
    assert.deepEqual(f.workbench.snapshot().processing.projects[project.id].done, { count: 1, members: [{ runId: run.id, panelId: run.panelId }] });
    const directory = join(f.directory, 'replacement'); await mkdir(directory);
    const replacement = await f.workbench.editProject(project.id, { name: project.name, directory }, true);
    const fresh = replacement.launches.find(l => l.run.panelId === run.panelId)!.run;
    await until(() => f.workbench.snapshot().processing.runs[fresh.id] === 'ready');
    assert.equal(await post(), 403);
    assert.equal(f.workbench.snapshot().processing.runs[run.id], undefined);
    assert.equal(f.workbench.snapshot().processing.runs[fresh.id], 'ready');
    await f.workbench.closePanel(project.id, fresh.panelId);
    assert.equal(f.workbench.snapshot().processing.runs[fresh.id], undefined);
  } finally { await f.close(); }
});

test('pi unavailable or lost observation leaves terminal input usable and cannot reuse a cached outcome', async () => {
  for (const args of [[], ['--skip-loading']]) {
    const f = await fixture(args);
    try {
      const { launches: [{ run }] } = await f.create();
      if (!args.length) {
        await f.send(run.id, { type: 'agent_start' });
        await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
        await f.send(run.id, { type: 'session_shutdown' });
        await f.send(run.id, { type: 'agent_settled' });
      }
      await f.send(run.id, undefined, { output: 'Ready Busy Done terminal echo' });
      assert.ok(f.output(run.id).includes('Ready Busy Done terminal echo'));
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
    } finally { await f.close(); }
  }
});

test('pi compaction waits for recovery or final settlement and manual compaction restores the prior idle result', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
    await check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'ready');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }, 'busy');
    await check({ type: 'agent_end' }, 'busy');
    await check({ type: 'session_before_compact', reason: 'overflow', willRetry: true }, 'busy');
    await check({ type: 'session_compact_failed', reason: 'overflow', willRetry: false }, 'busy');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'agent_settled' }, 'done');
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
    await check({ type: 'session_compact', reason: 'manual', willRetry: false }, 'done');
    await check({ type: 'session_before_compact', reason: 'manual' }, 'busy');
    await check({ type: 'session_compact_failed', reason: 'manual', aborted: false, willRetry: false }, 'error');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'session_before_compact', reason: 'threshold' }, 'busy');
    await check({ type: 'session_compact_failed', reason: 'threshold', aborted: false }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
  } finally { await f.close(); }
});

test('pi final outcomes require settlement without queued continuation, and retries cannot finish a turn early', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string, options = {}) => {
      await f.send(run.id, payload, options);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'tool_execution_end', isError: true }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'error' } }, 'busy');
    await check({ type: 'agent_end' }, 'busy');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'agent_settled' }, 'busy', { pendingMessages: true });
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'agent_settled' }, 'error');
    for (const [stopReason, expected] of [['stop', 'done'], ['error', 'error'], ['aborted', 'ready'], ['length', 'error'], ['toolUse', 'error']]) {
      await check({ type: 'agent_start' }, 'busy');
      await check({ type: 'message_end', message: { role: 'assistant', stopReason } }, 'busy');
      await check({ type: 'agent_end' }, 'busy');
      await check({ type: 'agent_settled' }, expected);
    }
  } finally { await f.close(); }
});

test('pi confirmed run cancellation returns Ready even without an aborted assistant message', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    for (const stopReason of ['error', 'stop', undefined]) {
      await f.send(run.id, { type: 'agent_start' });
      if (stopReason) await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason } });
      await f.send(run.id, { type: 'agent_end' });
      await f.send(run.id, { type: 'agent_settled', aborted: true });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'ready', String(stopReason));
    }
  } finally { await f.close(); }
});

test('pi cancellation requires no pending work and does not hide extension UI waits or real failure', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } });
    await f.send(run.id, { type: 'agent_settled', aborted: true }, { pendingMessages: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    await f.send(run.id, { type: 'ui_prompt_start' });
    await f.send(run.id, { type: 'agent_settled', aborted: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'needs-input');
    await f.send(run.id, { type: 'ui_prompt_end' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'ready');
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } });
    await f.send(run.id, { type: 'agent_settled', aborted: false });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
  } finally { await f.close(); }
});

test('pi extension UI waits outlive unrelated tools and restore the latest effective idle or processing fact', async () => {
  const f = await fixture();
  try {
    const { launches: [{ run }] } = await f.create();
    const check = async (payload: object, expected: string) => {
      await f.send(run.id, payload);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], expected, JSON.stringify(payload));
    };
    await check({ type: 'ui_prompt_start' }, 'needs-input');
    await check({ type: 'ui_prompt_end' }, 'ready');
    await check({ type: 'agent_start' }, 'busy');
    await check({ type: 'ui_prompt_start' }, 'needs-input');
    await check({ type: 'tool_execution_start' }, 'needs-input');
    await check({ type: 'tool_execution_end', isError: true }, 'needs-input');
    await check({ type: 'agent_start' }, 'needs-input');
    await check({ type: 'ui_prompt_end' }, 'busy');
    await check({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } }, 'busy');
    await check({ type: 'ui_prompt_start' }, 'needs-input');
    await check({ type: 'agent_settled' }, 'needs-input');
    await check({ type: 'ui_prompt_end' }, 'done');
  } finally { await f.close(); }
});
