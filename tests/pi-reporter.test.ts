import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './support/cli-double';

test('pi loads the invocation extension, and session shutdown leaves a usable terminal with Error', async () => {
  const f = await fixture('pi');
  try {
    const { project, launches: [{ run }] } = await f.create();
    assert.equal(f.state(run.id), 'ready');
    await f.send(run.id, { type: 'agent_start' });
    assert.equal(f.state(run.id), 'busy');
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_end' });
    assert.equal(f.state(run.id), 'busy');
    await f.send(run.id, { type: 'agent_settled' });
    assert.equal(f.state(run.id), 'done');
    const snapshots = f.events.flatMap(e => e.kind === 'snapshot' && e.snapshot.processing.runs[run.id] === 'done' ? [e.snapshot] : []);
    assert.ok(snapshots.length);
    for (const snapshot of snapshots) assert.deepEqual(snapshot.processing.projects[project.id].done,
      { count: 1, members: [{ panelId: run.panelId, runId: run.id }] });
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'session_shutdown' });
    await f.send(run.id, { type: 'agent_settled' });
    await f.send(run.id, undefined, { output: 'Ready Busy Done terminal echo' });
    assert.ok(f.output(run.id).includes('Ready Busy Done terminal echo'));
    assert.equal(f.state(run.id), 'error', 'an outcome from before the shutdown is not reused');
  } finally { await f.close(); }
});

test('pi settlement uses the final assistant outcome after existing extensions replace a message', async () => {
  const f = await fixture('pi', ['--discovered-extension', './rewrite.mjs']);
  try {
    await writeFile(join(f.directory, 'rewrite.mjs'), `export default pi => {
      pi.on('message_end', async event => event.message.role === 'assistant'
        ? { message: { ...event.message, stopReason: 'error' } } : undefined);
    };`);
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { type: 'agent_start' });
    await f.send(run.id, { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await f.send(run.id, { type: 'agent_end' });
    assert.equal(f.state(run.id), 'busy');
    await f.send(run.id, { type: 'agent_settled' });
    assert.equal(f.state(run.id), 'error');
  } finally { await f.close(); }
});

test('pi preserves explicit extensions and arguments, and reports still arrive after reload', async () => {
  const f = await fixture('pi', ['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
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
    assert.equal(f.state(run.id), 'ready');
    await f.send(run.id, { type: 'agent_start' });
    assert.equal(f.state(run.id), 'busy');
    assert.equal(await readFile(join(f.directory, 'existing.mjs'), 'utf8'), source);
    const args: string[] = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]);
    assert.deepEqual(args.slice(0, 3), ['--no-extensions', '-e', './existing.mjs']);
    assert.deepEqual(args.slice(-2), ['--', 'literal --extension']);
    assert.deepEqual(f.workbench.snapshot().settings.agents.pi.args.slice(1), ['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
  } finally { await f.close(); }
});
