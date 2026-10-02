// THROWAWAY diagnosis: exercise the real PTY host against Codex's startup UI.
// No model request; only color codes are reported, never terminal text.
// ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron plans/terminal.prototype/debug/color-probe.prototype.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'vibebridge-color-probe-'));
const command = (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'codex')).find(file => {
  try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
});
assert.ok(command, 'Codex must be installed for this startup probe');
fs.writeFileSync(path.join(runtime, 'launch.json'), JSON.stringify({ cwd: runtime, agents: [{ id: 'codex', path: command }] }));
let listener, output = '', pending = '', queryCount = 0, sequence = 0;
const requests = new Map();
const input = data => listener({ data: { type: 'input', id: 'probe', data } });
const fakeProcess = {
  argv: [process.execPath, 'host', runtime, String(process.pid)],
  env: { ...process.env, NO_COLOR: '1' },
  kill: process.kill.bind(process), on() {}, exit() {},
  parentPort: {
    on(_event, callback) { listener = callback; },
    postMessage(message) {
      if (message.requestId) {
        const waiter = requests.get(message.requestId);
        requests.delete(message.requestId);
        message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.result);
      }
      if (message.type !== 'output') return;
      output += message.data; pending += message.data;
      pending = pending.replace(/\x1b\](10|11);\?(?:\x07|\x1b\\)/g, (_, code) => {
        queryCount++;
        input(`\x1b]${code};rgb:${code === '11' ? 'ffff/ffff/ffff' : '0000/0000/0000'}\x1b\\`);
        return '';
      });
      if (pending.includes('\x1b[6n')) { input('\x1b[1;1R'); pending = pending.replaceAll('\x1b[6n', ''); }
      pending = pending.slice(-100);
    },
  },
};
function request(type) {
  return new Promise((resolve, reject) => {
    const requestId = ++sequence;
    requests.set(requestId, { resolve, reject });
    void listener({ data: { type, id: 'probe', agent: 'codex', cols: 90, rows: 30, requestId } });
  });
}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../host.prototype.cjs'), 'utf8'), {
  require, process: fakeProcess, Buffer, setTimeout, setInterval: () => ({ unref() {} }),
});
(async () => {
  try {
    await request('start');
    await new Promise(resolve => setTimeout(resolve, 3000));
  } finally { await request('stop'); }
  const sgr = [...new Set([...output.matchAll(/\x1b\[([0-9;:]*)m/g)].map(match => match[1]))];
  const hasBlue = sgr.some(code => [...code.matchAll(/(?:^|;)38;2;(\d+);(\d+);(\d+)(?=;|$)/g)].some(([, r, g, b]) => Number(b) > 100 && Number(r) < Number(b) * .7 && Number(g) < Number(b) * .8));
  console.log(JSON.stringify({ inheritedNO_COLOR: '1', backgroundQueries: queryCount, bytes: output.length, hasNativeBlue: hasBlue, result: hasBlue ? 'PASS' : 'FAIL: native blue missing' }, null, 2));
  assert.ok(queryCount > 0, 'Expected a foreground/background color query');
  assert.ok(hasBlue, 'The real PTY host must preserve Codex native blue on a light background');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
