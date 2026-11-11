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
// With --hold-session the double reports nothing until asked, so its session and Ready arrive when the test sends them.
let pending = (args.includes('--hold-session') ? Promise.resolve() : emit({ hook_event_name: 'SessionStart', source: 'startup' }))
  .then(() => console.log('CLI-DOUBLE-READY'));
// With --echo-bytes the double reads raw input, as the real TUI does, and reports the bytes of
// each read; a line that starts with `{` holds a request. The terminal may join several writes into one
// read or split one across reads, so requests are taken from lines, whatever the reads.
if (args.includes('--echo-bytes')) {
  process.stdin.setRawMode(true);
  let unfinished = '';
  process.stdin.on('data', data => {
    console.log(`BYTES:${data.toString('hex')}`);
    const lines = (unfinished + data.toString()).split(/[\r\n]/);
    unfinished = lines.pop();
    lines.filter(line => line.startsWith('{')).forEach(handle);
  });
} else readline.createInterface({ input: process.stdin }).on('line', handle);
function handle(line) {
  pending = pending.then(async () => {
    const message = JSON.parse(line);
    if (message.context) console.log(`CONTEXT:${process.env.VIBEBRIDGE_STATUS_CONTEXT}`);
    if (message.settings) console.log(`SETTINGS:${JSON.stringify(settings)}`);
    if (message.arguments) console.log(`ARGUMENTS:${JSON.stringify(args)}`);
    // Facts too large for one terminal input line arrive as a file.
    const payload = message.payloadFile ? JSON.parse(readFileSync(message.payloadFile, 'utf8')) : message.payload;
    if (payload) await emit(payload, message.malformed);
    if (message.output) console.log(message.output);
    console.log(`ACK:${message.id}`);
    if (message.exit) process.exit(0);
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
