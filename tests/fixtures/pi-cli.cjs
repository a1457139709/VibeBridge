const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

// External CLI double: loads invocation extensions and supplies the official
// callback/context boundary. It does not know the status reporting protocol.
const args = process.argv.slice(2);
const handlers = new Map();
let idle = true;
let pendingMessages = false;
let messages = [];
const context = { isIdle: () => idle, hasPendingMessages: () => pendingMessages };
const api = { on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); } };
async function emit(event) {
  if (event.type === 'agent_start') { idle = false; messages = []; }
  if (event.type === 'agent_settled') idle = true;
  if (event.type === 'agent_end' && !event.messages) event.messages = messages;
  for (const handler of handlers.get(event.type) ?? []) {
    const result = await handler(event, context);
    if (event.type === 'message_end' && result?.message) event.message = result.message;
    else if (result !== undefined) throw new Error('Unexpected extension decision');
  }
  if (event.type === 'message_end') messages.push(event.message);
}
async function load() {
  handlers.clear();
  if (!args.includes('--skip-loading')) for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    if (args[i] === '-e' || args[i] === '--extension') (await import(pathToFileURL(resolve(args[++i])).href)).default(api);
  }
  // Pi loads discovered extensions after explicit invocation extensions.
  const discovered = args.indexOf('--discovered-extension');
  if (discovered >= 0) (await import(pathToFileURL(resolve(args[discovered + 1])).href)).default(api);
  await emit({ type: 'session_start' });
}
let pending = load().then(() => console.log('CLI-DOUBLE-READY'));
readline.createInterface({ input: process.stdin }).on('line', line => {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.idle !== undefined) idle = message.idle;
    pendingMessages = message.pendingMessages ?? false;
    if (message.reload) { await emit({ type: 'session_shutdown' }); await load(); }
    if (message.context) console.log(`CONTEXT:${process.env.VIBEBRIDGE_STATUS_CONTEXT}`);
    if (message.arguments) console.log(`ARGUMENTS:${JSON.stringify(args)}`);
    if (message.payload) await emit(message.payload);
    if (message.output) console.log(message.output);
    console.log(`ACK:${message.id}`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
});
