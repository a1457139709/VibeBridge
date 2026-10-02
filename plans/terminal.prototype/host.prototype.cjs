// THROWAWAY: all real PTYs live here, separate from Electron's main/renderer.
const pty = require('node-pty');
const fs = require('node:fs');
const path = require('node:path');
const [runtime, parentPid] = process.argv.slice(2);
const { agents, cwd } = JSON.parse(fs.readFileSync(path.join(runtime, 'launch.json'), 'utf8'));
const runs = new Map();
const stopping = new Map();
let shuttingDown = false;
const send = message => process.parentPort.postMessage(message);
const grid = value => Number.isInteger(value) && value > 0 && value < 2000;
function signalGroup(run, signal) {
  try { process.kill(-run.pid, signal); } catch { try { run.kill(signal); } catch {} }
}
async function stop(id) {
  if (stopping.has(id)) return stopping.get(id);
  const run = runs.get(id);
  if (!run) return;
  const done = (async () => {
    signalGroup(run, 'SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 600));
    signalGroup(run, 'SIGKILL');
    runs.delete(id);
  })();
  stopping.set(id, done);
  await done;
  stopping.delete(id);
}
process.parentPort.on('message', async ({ data: message }) => {
  const { type, id, requestId } = message;
  try {
    let result;
    if (type === 'start') {
      if (shuttingDown || runs.size >= 4 || typeof id !== 'string' || runs.has(id)) throw new Error('原型最多同时运行四个 Agent');
      const agent = agents.find(item => item.id === message.agent);
      if (!agent?.path) throw new Error('未在启动环境 PATH 中找到此 CLI');
      if (!grid(message.cols) || !grid(message.rows)) throw new Error('无效终端尺寸');
      const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'VibeBridge', LANG: process.env.LANG || 'en_US.UTF-8' };
      for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_CHANNEL_FD', 'VIBEBRIDGE_PROTOTYPE_RUNTIME']) delete env[key];
      // The launcher may run in an agent's plain-text command environment.
      // This child has a real color terminal; do not inherit its NO_COLOR flag.
      delete env.NO_COLOR;
      const run = pty.spawn(agent.path, [], { name: 'xterm-256color', cols: message.cols, rows: message.rows, cwd, env });
      runs.set(id, run);
      run.onData(data => send({ type: 'output', id, data }));
      run.onExit(({ exitCode, signal }) => {
        // The CLI may leave a subprocess in its session; clean up its process group too.
        void stop(id);
        send({ type: 'exit', id, exitCode, signal });
      });
      result = { pid: run.pid };
    } else if (type === 'input') {
      if (typeof message.data === 'string') runs.get(id)?.write(message.binary ? Buffer.from(message.data, 'binary') : message.data);
    } else if (type === 'resize') {
      if (grid(message.cols) && grid(message.rows)) runs.get(id)?.resize(message.cols, message.rows);
    } else if (type === 'stop') await stop(id);
    else if (type === 'shutdown') { shuttingDown = true; await Promise.all([...runs.keys()].map(stop)); }
    if (requestId) send({ requestId, result });
  } catch (error) {
    if (requestId) send({ requestId, error: error.message });
    else send({ type: 'error', id, message: error.message });
  }
});
setInterval(() => {
  try { process.kill(Number(parentPid), 0); }
  catch { shuttingDown = true; void Promise.all([...runs.keys()].map(stop)).finally(() => process.exit()); }
}, 1000).unref();
process.on('SIGTERM', () => { shuttingDown = true; void Promise.all([...runs.keys()].map(stop)).finally(() => process.exit()); });
send({ type: 'ready' });
