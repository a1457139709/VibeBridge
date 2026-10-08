import * as pty from 'node-pty';
import type { AgentCommand, Run, TerminalEvent } from '../shared/model';
import { commandEnvironment, executable } from './environment';
import { descendants, processTable, stopProcesses, type ProcessIdentity } from './processes';

const runs = new Map<string, { run: Run; terminal: pty.IPty; processes: ProcessIdentity[]; stopping: boolean }>();
let environment: Promise<Record<string, string>> | undefined;
let closing = false;
const send = (message: unknown) => { if (process.connected) process.send!(message); };
const event = (value: TerminalEvent) => send({ event: value });
let sampling = false;
async function sample() {
  if (sampling) return;
  sampling = true;
  try {
    const table = await processTable();
    for (const entry of runs.values()) entry.processes = descendants(table, entry.processes);
    send({ processes: [...runs.values()].flatMap(entry => entry.processes) });
  } finally { sampling = false; }
}
const sampler = setInterval(() => { void sample().catch(error => console.error(error.message)); }, 500);

async function stop(id: string) {
  const entry = runs.get(id);
  if (!entry) return;
  entry.stopping = true;
  await sample();
  await stopProcesses(entry.processes);
  try { entry.terminal.kill(); } catch { /* already exited */ }
  runs.delete(id);
  event({ kind: 'exit', runId: id });
}

async function shutdown() {
  closing = true;
  clearInterval(sampler);
  const results = await Promise.allSettled([...runs.keys()].map(stop));
  const failure = results.find(r => r.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

async function handle(operation: string, value: any) {
  if (operation === 'shutdown') { await shutdown(); return; }
  if (closing) throw new Error('工作台正在退出');
  if (operation === 'check-command') {
    try {
      environment ??= commandEnvironment();
      return { available: true, path: await executable(value, await environment) };
    } catch (error) { return { available: false, message: `命令不可用，请检查程序路径及执行权限：${(error as Error).message}` }; }
  }
  if (operation === 'start') {
    const { id, panelId, projectId, directory, command } = value as { id: string; panelId: string; projectId: string; directory: string; command: AgentCommand };
    try {
      environment ??= commandEnvironment();
      const env = await environment;
      const program = await executable(command.command, env);
      const terminal = pty.spawn(program, command.args, { cwd: directory, env, name: 'xterm-256color', cols: 80, rows: 24 });
      const run: Run = { id, panelId, projectId, pid: terminal.pid, state: 'running' };
      const entry = { run, terminal, processes: [] as ProcessIdentity[], stopping: false };
      runs.set(id, entry);
      event({ kind: 'started', run });
      terminal.onData(data => event({ kind: 'output', runId: id, data }));
      terminal.onExit(() => {
        if (entry.stopping) return;
        void stop(id).catch(error => send({ failure: String(error) }));
      });
      const identity = (await processTable()).find(p => p.pid === terminal.pid);
      if (identity) entry.processes = [identity];
      await sample();
      return run;
    } catch (error) {
      console.error('Agent launch failed:', error);
      const run: Run = { id, panelId, projectId, state: 'failed' };
      event({ kind: 'started', run });
      return run;
    }
  }
  const entry = runs.get(value.runId);
  // Layout transitions may finish after a panel has stopped. Only input requires a live target.
  if (operation === 'resize' && (!entry || entry.stopping)) return;
  if (!entry || entry.stopping) throw new Error('运行已失效');
  if (operation === 'input') {
    if (typeof value.data !== 'string' || value.data.length > 1024 * 1024) throw new Error('终端输入无效');
    entry.terminal.write(value.data);
  } else if (operation === 'resize') {
    if (![value.cols, value.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error('终端尺寸无效');
    entry.terminal.resize(value.cols, value.rows);
  } else if (operation === 'stop') await stop(value.runId);
  else throw new Error('未知终端操作');
}

let requests = Promise.resolve();
process.on('message', (message: any) => {
  requests = requests.then(async () => {
    try { send({ id: message.id, result: await handle(message.operation, message.value) }); }
    catch (error) { send({ id: message.id, error: (error as Error).message }); }
    if (message.operation === 'shutdown' && process.connected) process.disconnect!();
  });
});
process.on('disconnect', () => { void shutdown().finally(() => process.exit()); });
