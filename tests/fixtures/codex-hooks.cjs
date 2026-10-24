const { parse } = require('smol-toml');
const { spawn } = require('node:child_process');
const readline = require('node:readline');

// External CLI double: consume Codex's launch flags and invoke its command-hook
// protocol. It deliberately knows nothing about Workbench's reporting transport.
const hooks = {};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  const value = arg === '-c' || arg === '--config' ? args[++index]
    : arg.startsWith('--config=') ? arg.slice(9) : arg.startsWith('-c=') ? arg.slice(3) : arg.startsWith('-c') ? arg.slice(2) : undefined;
  if (!value) continue;
  const config = parse(value);
  if (config.hooks) Object.assign(hooks, config.hooks);
}
const session = `session-${process.pid}`;
async function emit(payload) {
  const input = { session_id: session, cwd: process.cwd(), transcript_path: null,
    model: 'fixture', permission_mode: 'default', ...payload };
  await Promise.all((hooks[input.hook_event_name] || []).flatMap(group => group.hooks).map(handler => new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', handler.command], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Hook exited ${code}`)));
    child.stdin.end(JSON.stringify(input));
  })));
}
let pending = emit({ hook_event_name: 'SessionStart', source: 'startup' }).then(() => console.log('CODEX-HOOKS-READY'));
readline.createInterface({ input: process.stdin }).on('line', line => {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.context) console.log(`CONTEXT:${process.env.VIBEBRIDGE_STATUS_CONTEXT}`);
    if (message.payload) await emit({ ...message.payload, ...(message.oversized ? { session_id: 'x'.repeat(70000) } : {}) });
    if (message.output) console.log(message.output);
    console.log(`ACK:${message.id}`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
});
