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
// As in Codex, a hook that fails or outlives its timeout does not stop the event; the double
// reports it as HOOK-FAILED or HOOK-TIMEOUT so the test sees why instead of waiting.
/** Runs one command hook; resolves to its HOOK-FAILED or HOOK-TIMEOUT report, or undefined when it succeeded. */
function runHook(handler, input) {
  return new Promise(resolve => {
    // Its own process group, so a timeout also stops whatever the shell started.
    const child = spawn('/bin/sh', ['-c', handler.command], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let timedOut = false;
    const timer = handler.timeout && setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, handler.timeout * 1000);
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); resolve(`HOOK-FAILED:${error.message}`); });
    // 'close' follows the hook's last output, so that output arrives before the ACK.
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve(timedOut ? `HOOK-TIMEOUT:${handler.timeout}s` : code === 0 ? undefined : `HOOK-FAILED:${signal ?? `exit ${code}`}`);
    });
    child.stdin.end(JSON.stringify(input));
  });
}
async function emit(payload) {
  const input = { session_id: session, cwd: process.cwd(), transcript_path: null,
    model: 'fixture', permission_mode: 'default', ...payload };
  const handlers = (hooks[input.hook_event_name] || []).flatMap(group => group.hooks);
  for (const problem of await Promise.all(handlers.map(handler => runHook(handler, input)))) if (problem) console.log(problem);
}
let pending = emit({ hook_event_name: 'SessionStart', source: 'startup' }).then(() => console.log('CLI-DOUBLE-READY'));
readline.createInterface({ input: process.stdin }).on('line', line => {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.context) console.log(`CONTEXT:${process.env.VIBEBRIDGE_STATUS_CONTEXT}`);
    if (message.payload) await emit({ ...message.payload, ...(message.oversized ? { session_id: 'x'.repeat(70000) } : {}) });
    if (message.output) console.log(message.output);
    console.log(`ACK:${message.id}`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
});
