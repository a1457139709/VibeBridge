const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const readline = require('node:readline');

// External CLI double: reads Claude's session settings and executes native
// command hooks. It has no knowledge of the Workbench reporting protocol.
let settings = {};
const args = process.argv.slice(2);
for (let index = 0; index < args.length && args[index] !== '--'; index++) {
  const value = args[index] === '--settings' ? args[++index]
    : args[index].startsWith('--settings=') ? args[index].slice(11) : undefined;
  if (value) {
    try { settings = JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8')); }
    catch { settings = {}; }
  }
}
const session = `session-${process.pid}`;
async function emit(payload, malformed) {
  const input = { session_id: session, cwd: process.cwd(), permission_mode: 'default', ...payload };
  const groups = settings.disableAllHooks ? [] : settings.hooks?.[input.hook_event_name] ?? [];
  await Promise.all(groups.filter(group => !group.matcher || new RegExp(group.matcher).test(input.tool_name ?? input.source ?? ''))
    .flatMap(group => group.hooks).map(handler => new Promise((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', handler.command], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.on('data', data => process.stdout.write(data));
      child.stderr.on('data', data => process.stderr.write(data));
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Hook exited ${code}`)));
      child.stdin.end(malformed ? '{' : JSON.stringify(input));
    })));
}
let pending = emit({ hook_event_name: 'SessionStart', source: 'startup' }).then(() => console.log('CLI-DOUBLE-READY'));
// With --raw-input the double reads the terminal byte by byte, as an interactive CLI does: bracketed pastes and
// Enter (\r) are typed input, kept apart from the test's own messages, which end in \n.
let typed = '';
function lines(onLine) {
  if (!args.includes('--raw-input')) { readline.createInterface({ input: process.stdin }).on('line', onLine); return; }
  process.stdin.setRawMode(true);
  let buffer = '', line = '';
  process.stdin.on('data', data => {
    buffer += data.toString();
    for (;;) {
      if (buffer.startsWith('\x1b[200~')) {
        const end = buffer.indexOf('\x1b[201~');
        if (end < 0) return;
        typed += buffer.slice(0, end + 6); buffer = buffer.slice(end + 6);
      } else if ('\x1b[200~'.startsWith(buffer)) return; // empty, or a paste start split across reads
      else {
        const next = buffer[0]; buffer = buffer.slice(1);
        if (next === '\r') typed += next;
        else if (next === '\n') { onLine(line); line = ''; }
        else line += next;
      }
    }
  });
}
lines(line => {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.typed) console.log(`TYPED:${JSON.stringify(typed)}`);
    if (message.context) console.log(`CONTEXT:${process.env.VIBEBRIDGE_STATUS_CONTEXT}`);
    if (message.settings) console.log(`SETTINGS:${JSON.stringify(settings)}`);
    if (message.arguments) console.log(`ARGUMENTS:${JSON.stringify(args)}`);
    // Facts too large for one terminal input line arrive as a file.
    const payload = message.payloadFile ? JSON.parse(readFileSync(message.payloadFile, 'utf8')) : message.payload;
    if (payload) await emit(payload, message.malformed);
    if (message.output) console.log(message.output);
    console.log(`ACK:${message.id}`);
  }).catch(error => { console.error(error); process.exitCode = 1; });
});
