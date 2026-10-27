import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { fixture, until } from './support/cli-double';
import { showing, statusOf } from './support/panel-views';

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
    const snapshots = f.events.flatMap(e => e.kind === 'snapshot' && statusOf(e.snapshot, run.id) === 'done' ? [e.snapshot] : []);
    assert.ok(snapshots.length);
    for (const snapshot of snapshots) assert.deepEqual(showing(snapshot, project.id, 'done'),
      [[run.panelId, run.id]]);
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

test('pi preserves explicit extensions and arguments', async () => {
  const f = await fixture('pi', ['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
  try {
    const source = `export default pi => { pi.on('session_start', async () => { console.log('EXISTING_EXTENSION_OK'); }); };`;
    await writeFile(join(f.directory, 'existing.mjs'), source);
    // The CLI resolves user paths relative to its project, just as pi does.
    const { launches: [{ run }] } = await f.create();
    assert.ok(f.output(run.id).includes('EXISTING_EXTENSION_OK'));
    await f.send(run.id, undefined, { arguments: true });
    assert.equal(await readFile(join(f.directory, 'existing.mjs'), 'utf8'), source);
    const args: string[] = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]);
    assert.deepEqual(args.slice(0, 3), ['--no-extensions', '-e', './existing.mjs']);
    assert.deepEqual(args.slice(-2), ['--', 'literal --extension']);
    assert.deepEqual(f.workbench.snapshot().settings.agents.pi.args.slice(1), ['--no-extensions', '-e', './existing.mjs', '--', 'literal --extension']);
  } finally { await f.close(); }
});

test('pi /reload keeps delivering through the launch\'s one queue, so a reloaded reporter waits for earlier reports', async () => {
  const received: string[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', async () => {
      const { type } = JSON.parse(body).payload;
      received.push(type);
      if (received.length === 1) await held;
      response.writeHead(204).end();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.VIBEBRIDGE_STATUS_CONTEXT;
  const { port } = server.address() as AddressInfo;
  process.env.VIBEBRIDGE_STATUS_CONTEXT = JSON.stringify({ url: `http://127.0.0.1:${port}/events`, runId: 'reload', agent: 'pi', token: randomUUID() });
  // pi /reload loads a fresh copy of the extension module within the same process. The CLI double's
  // import cache would reuse one module, so this test loads each copy itself.
  const load = async (instance: string) => {
    const handlers = new Map<string, (event: object, context: object) => Promise<void>>();
    const module = await import(`${pathToFileURL(join(__dirname, 'pi-reporter.mjs')).href}?${instance}`);
    module.default({ on: (name: string, handler: (event: object, context: object) => Promise<void>) => handlers.set(name, handler) });
    return (type: string) => handlers.get(type)!({ type }, { isIdle: () => false, hasPendingMessages: () => false });
  };
  try {
    const before = (await load('before'))('agent_start');
    await until(() => received.length === 1);
    const after = (await load('after'))('tool_execution_start');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(received, ['agent_start'], 'the reloaded reporter does not overtake an undelivered report');
    release();
    await Promise.all([before, after]);
    assert.deepEqual(received, ['agent_start', 'tool_execution_start']);
  } finally {
    release();
    if (previous === undefined) delete process.env.VIBEBRIDGE_STATUS_CONTEXT; else process.env.VIBEBRIDGE_STATUS_CONTEXT = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
