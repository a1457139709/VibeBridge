import { message, detail } from '../shared/messages';
import { observeTitles } from './titles';
import * as pty from 'node-pty';
import type { AgentCommand, Run, TerminalEvent } from '../shared/model';
import { commandEnvironment, executable } from './environment';
import { descendants, processTable, stopProcesses, type ProcessIdentity } from './processes';
import { recordFailure } from './failure';

interface ManagedRun {
  run: Run; terminal: pty.IPty; processes: ProcessIdentity[]; stopping: boolean; stop?: Promise<void>;
  outstanding: number; paused: boolean; draining: boolean;
}
const runs = new Map<string, ManagedRun>();
const owner = process.env.VIBEBRIDGE_HOST_OWNER!;
let environment: Promise<Record<string, string>> | undefined;
let closing = false;
// A peer can die between the connected check and the write. Let disconnect own cleanup.
const send = (message: unknown) => { if (process.connected) process.send!(message, () => {}); };
const event = (value: TerminalEvent) => send({ event: value });
let sampling: Promise<void> | undefined;
function sample(): Promise<void> {
  sampling ??= (async () => {
    const table = await processTable();
    for (const entry of runs.values()) entry.processes = descendants(table, entry.processes);
    send({ processes: [...runs.values()].flatMap(entry => entry.processes) });
  })().finally(() => { sampling = undefined; });
  return sampling;
}
const sampler = setInterval(() => { void sample().catch(error => console.error(error.message)); }, 500);

function drainAfterKill(entry: ManagedRun) {
  // macOS can wait for PTY output to drain while reaping a killed producer. After SIGKILL
  // only the finite kernel buffer remains; forward it without waiting for a lost renderer.
  entry.draining = true;
  entry.terminal.resume();
}

async function stop(id: string) {
  const entry = runs.get(id);
  if (!entry) return;
  if (entry.stop) return entry.stop;
  entry.stopping = true;
  event({ kind: 'stopping', runId: id });
  entry.stop = (async () => {
    await sample();
    await stopProcesses(entry.processes, `${owner}:${id}`, () => drainAfterKill(entry));
    runs.delete(id);
    event({ kind: 'exit', runId: id });
  })();
  return entry.stop;
}

let shuttingDown: Promise<void> | undefined;
function shutdown(): Promise<void> {
  if (shuttingDown) return shuttingDown;
  closing = true;
  clearInterval(sampler);
  for (const entry of runs.values()) { entry.stopping = true; event({ kind: 'stopping', runId: entry.run.id }); }
  shuttingDown = (async () => {
    await sampling;
    await stopProcesses([...runs.values()].flatMap(entry => entry.processes), owner, () => {
      for (const entry of runs.values()) drainAfterKill(entry);
    });
    runs.clear();
  })();
  return shuttingDown;
}

async function handle(operation: string, value: any) {
  if (operation === 'shutdown') { await shutdown(); return; }
  if (closing) throw new Error(message('quitting'));
  if (operation === 'check-command') {
    try {
      environment ??= commandEnvironment();
      return { available: true, path: await executable(value, await environment) };
    } catch (error) { return { available: false, message: message('commandUnavailable', { reason: detail((error as Error).message) }) }; }
  }
  if (operation === 'start') {
    const { id, panelId, projectId, directory, command, integration } = value as { id: string; panelId: string; projectId: string; directory: string; command: AgentCommand; integration: Record<string, string> };
    try {
      environment ??= commandEnvironment();
      const env = await environment;
      const program = await executable(command.command, env);
      if (closing) throw new Error(message('quitting'));
      const terminal = pty.spawn(program, command.args, { cwd: directory, env: { ...env, ...integration, VIBEBRIDGE_RUN_OWNER: `${owner}:${id}` }, name: 'xterm-256color', cols: 80, rows: 24 });
      const run: Run = { id, panelId, projectId, pid: terminal.pid, state: 'running' };
      const entry = { run, terminal, processes: [] as ProcessIdentity[], stopping: false, outstanding: 0, paused: false, draining: false };
      runs.set(id, entry);
      event({ kind: 'started', run });
      const titles = observeTitles(title => event({ kind: 'title', runId: id, title }));
      terminal.onData(data => {
        titles(data);
        entry.outstanding += data.length;
        event({ kind: 'output', runId: id, data });
        // Credit covers every hop through IPC and xterm's parser. Do not truncate output.
        if (!entry.draining && entry.outstanding >= 128 * 1024) { terminal.pause(); entry.paused = true; }
      });
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
  // A stopping run still shows its panel until cleanup ends; drop typing or terminal replies meanwhile.
  if (operation === 'input' && entry?.stopping) return;
  if (!entry || entry.stopping) throw new Error(message('runInvalid'));
  if (operation === 'input') {
    if (typeof value.data !== 'string' || value.data.length > 1024 * 1024) throw new Error(message('terminalInputInvalid'));
    entry.terminal.write(value.data);
  } else if (operation === 'resize') {
    if (![value.cols, value.rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000)) throw new Error(message('terminalSizeInvalid'));
    entry.terminal.resize(value.cols, value.rows);
  } else if (operation === 'stop') await stop(value.runId);
  else throw new Error(message('terminalOperationUnknown'));
}

let requests = Promise.resolve();
process.on('message', (message: any) => {
  // Parser acknowledgements must not wait behind a stop/start operation.
  if (message.operation === 'output-consumed') {
    const entry = runs.get(message.value.runId);
    const characters = message.value.characters;
    if (entry && Number.isInteger(characters) && characters > 0 && characters <= entry.outstanding) {
      entry.outstanding -= characters;
      if (entry.paused && entry.outstanding < 64 * 1024) { entry.paused = false; entry.terminal.resume(); }
    }
    return;
  }
  requests = requests.then(async () => {
    try { send({ id: message.id, result: await handle(message.operation, message.value) }); }
    catch (error) { send({ id: message.id, error: (error as Error).message }); }
    if (message.operation === 'shutdown' && process.connected) process.disconnect!();
  });
});
process.on('disconnect', () => {
  const unexpected = !closing;
  void (async () => {
    let cleanupError: unknown;
    try { await shutdown(); } catch (error) { cleanupError = error; }
    if (unexpected) await recordFailure(process.env.VIBEBRIDGE_FAULT_FILE!, 'main', message('mainDisconnected'), cleanupError);
    else if (cleanupError) console.error(cleanupError);
  })().catch(error => console.error(message('failureRecordFailed', { reason: detail(error.message) }))).finally(() => process.exit());
});
