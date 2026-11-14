import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
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

/** The test is the transport for in-process reporters: each report is held until the test delivers it.
 * Restore the real transport and environment with the returned `restore`. */
function holdReports(runId: string) {
  const requests: { payload: Record<string, unknown>; deliver(): void }[] = [];
  const original = http.request;
  http.request = ((_url: string, _options: object, respond: (response: object) => void) => {
    const listeners = new Map<string, () => void>();
    const outgoing = {
      once(name: string, listener: () => void) { listeners.set(name, listener); return outgoing; },
      destroy() {},
      end(body: string) {
        requests.push({ payload: JSON.parse(body).payload, deliver() {
          const ended = new Map<string, () => void>();
          respond({ statusCode: 204, resume() {}, once(name: string, listener: () => void) { ended.set(name, listener); } });
          ended.get('end')!();
          listeners.get('close')!();
        } });
      },
    };
    return outgoing;
  }) as unknown as typeof http.request;
  syncBuiltinESMExports();
  const previous = process.env.VIBEBRIDGE_STATUS_CONTEXT;
  process.env.VIBEBRIDGE_STATUS_CONTEXT = JSON.stringify({ url: 'http://127.0.0.1:9/events', runId, agent: 'pi', token: randomUUID() });
  return { requests, restore() {
    http.request = original;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.VIBEBRIDGE_STATUS_CONTEXT; else process.env.VIBEBRIDGE_STATUS_CONTEXT = previous;
  } };
}

type Handler = (event: object, context: object) => Promise<void>;
/** pi /reload loads a fresh copy of the extension module within the same process. The CLI double's
 * import cache would reuse one module, so these tests load each copy themselves. */
async function loadReporter(instance: string) {
  const handlers = new Map<string, Handler>();
  const module = await import(`${pathToFileURL(join(__dirname, 'pi-reporter.mjs')).href}?${instance}`);
  module.default({ on: (name: string, handler: Handler) => handlers.set(name, handler) });
  return (type: string, context: object = {}) => handlers.get(type)!({ type }, { isIdle: () => false, hasPendingMessages: () => false, ...context });
}
// No report waits on I/O, so once queued callbacks have run, every report that can be sent has been.
const settled = () => new Promise(resolve => setImmediate(resolve));

test('pi /reload keeps delivering through the launch\'s one queue, so a reloaded reporter waits for earlier reports', async () => {
  const { requests, restore } = holdReports('reload');
  const sent = () => requests.map(request => request.payload.type);
  try {
    const before = (await loadReporter('before'))('agent_start');
    await settled();
    assert.deepEqual(sent(), ['agent_start']);
    const after = (await loadReporter('after'))('tool_execution_start');
    await settled();
    assert.deepEqual(sent(), ['agent_start'], 'the reloaded reporter does not overtake an undelivered report');
    requests[0].deliver();
    await before;
    await settled();
    assert.deepEqual(sent(), ['agent_start', 'tool_execution_start']);
    requests[1].deliver();
    await after;
  } finally { restore(); }
});

test('pi reports forward the current session ID from the official session manager', async () => {
  const { requests, restore } = holdReports('session');
  const sessionManager = (id: string) => ({ sessionManager: { getSessionId: () => id } });
  const deliver = async (report: Promise<void>) => { await settled(); requests.at(-1)!.deliver(); await report; };
  try {
    const send = await loadReporter('session');
    await deliver(send('session_start', sessionManager('first')));
    await deliver(send('agent_start', sessionManager('first')));
    await deliver(send('session_start', sessionManager('resumed')));
    await deliver(send('agent_start', { sessionManager: { getSessionId: () => { throw new Error('unavailable'); } } }));
    assert.deepEqual(requests.map(({ payload }) => [payload.type, payload.sessionId]),
      [['session_start', 'first'], ['agent_start', 'first'], ['session_start', 'resumed'], ['agent_start', undefined]],
      'a session manager that cannot answer leaves the status fact intact');
  } finally { restore(); }
});
