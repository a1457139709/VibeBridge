import { message, nestedMessage } from '../shared/messages';
import { observeTitles } from './titles';
import * as pty from 'node-pty';
import type { Run, TerminalEvent } from '../shared/model';
import { readLoginEnvironment, resolveExecutable } from './environment';
import { ownedProcessTree, readProcessTable, stopProcesses, type ProcessIdentity } from './processes';
import { recordFailure } from './failure';
import { errorMessage } from '../shared/caught-error';
import { hostRequestSchema, requestIdOf, type HostOperation, type HostReport } from './protocol';

interface ManagedRun {
  run: Run;
  terminal: pty.IPty;
  processes: ProcessIdentity[];
  stopping: boolean;
  stopTask?: Promise<void>;
  unacknowledgedOutput: number;
  paused: boolean;
  draining: boolean;
}
const runs = new Map<string, ManagedRun>();
function workbenchVariable(name: 'VIBEBRIDGE_HOST_OWNER' | 'VIBEBRIDGE_FAULT_FILE'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is unset: the terminal host runs only as the Workbench's child process`);
  return value;
}
const owner = workbenchVariable('VIBEBRIDGE_HOST_OWNER');
let environment: Promise<Record<string, string>> | undefined;
let shuttingDown = false;
const send = (message: HostReport) => {
  if (process.connected) process.send?.(message, () => {});
};
const emitEvent = (event: TerminalEvent) => send({ kind: 'event', event });
let sampling: Promise<void> | undefined;
function sampleAndReportProcesses(): Promise<void> {
  sampling ??= (async () => {
    const table = await readProcessTable();
    for (const entry of runs.values()) entry.processes = ownedProcessTree(table, entry.processes);
    send({ kind: 'processes', processes: [...runs.values()].flatMap(entry => entry.processes) });
  })().finally(() => {
    sampling = undefined;
  });
  return sampling;
}
const sampler = setInterval(() => {
  void sampleAndReportProcesses().catch(error => console.error(error.message));
}, 500);

function drainAfterKill(entry: ManagedRun) {
  entry.draining = true;
  entry.terminal.resume();
}

async function stop(id: string) {
  const entry = runs.get(id);
  if (!entry) return;
  if (entry.stopTask) return entry.stopTask;
  entry.stopping = true;
  emitEvent({ kind: 'stopping', runId: id });
  entry.stopTask = (async () => {
    await sampleAndReportProcesses();
    await stopProcesses(entry.processes, `${owner}:${id}`, () => drainAfterKill(entry));
    runs.delete(id);
    emitEvent({ kind: 'exit', runId: id });
  })();
  return entry.stopTask;
}

let shutdownTask: Promise<void> | undefined;
function shutdown(): Promise<void> {
  if (shutdownTask) return shutdownTask;
  shuttingDown = true;
  clearInterval(sampler);
  for (const entry of runs.values()) {
    entry.stopping = true;
    emitEvent({ kind: 'stopping', runId: entry.run.id });
  }
  shutdownTask = (async () => {
    await sampling;
    await stopProcesses(
      [...runs.values()].flatMap(entry => entry.processes),
      owner,
      () => {
        for (const entry of runs.values()) drainAfterKill(entry);
      },
    );
    runs.clear();
  })();
  return shutdownTask;
}

async function performOperation(request: HostOperation) {
  if (request.operation === 'shutdown') {
    await shutdown();
    return;
  }
  if (shuttingDown) throw new Error(message('quitting'));
  if (request.operation === 'check-command') {
    try {
      environment ??= readLoginEnvironment();
      return { available: true, path: await resolveExecutable(request.value, await environment) };
    } catch (error) {
      return {
        available: false,
        message: message('commandUnavailable', { reason: nestedMessage(errorMessage(error)) }),
      };
    }
  }
  if (request.operation === 'start') {
    const { id, panelId, projectId, directory, command, extraEnvironment } = request.value;
    try {
      environment ??= readLoginEnvironment();
      const env = await environment;
      const program = await resolveExecutable(command.command, env);
      if (shuttingDown) throw new Error(message('quitting'));
      const terminal = pty.spawn(program, command.args, {
        cwd: directory,
        env: { ...env, ...extraEnvironment, VIBEBRIDGE_RUN_OWNER: `${owner}:${id}` },
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
      });
      const run: Run = { id, panelId, projectId, pid: terminal.pid, state: 'running' };
      const entry: ManagedRun = {
        run,
        terminal,
        processes: [],
        stopping: false,
        unacknowledgedOutput: 0,
        paused: false,
        draining: false,
      };
      runs.set(id, entry);
      emitEvent({ kind: 'started', run });
      const titles = observeTitles(title => emitEvent({ kind: 'title', runId: id, title }));
      terminal.onData(data => {
        titles(data);
        entry.unacknowledgedOutput += data.length;
        emitEvent({ kind: 'output', runId: id, data });
        if (!entry.draining && entry.unacknowledgedOutput >= 128 * 1024) {
          terminal.pause();
          entry.paused = true;
        }
      });
      terminal.onExit(() => {
        if (entry.stopping) return;
        void stop(id).catch(error => send({ kind: 'failure', message: String(error) }));
      });
      const identity = (await readProcessTable()).find(p => p.pid === terminal.pid);
      if (identity) entry.processes = [identity];
      await sampleAndReportProcesses();
      return run;
    } catch (error) {
      console.error('Agent launch failed:', error);
      const run: Run = { id, panelId, projectId, state: 'failed' };
      emitEvent({ kind: 'started', run });
      return run;
    }
  }
  const entry = runs.get(request.value.runId);
  if (request.operation === 'resize' && (!entry || entry.stopping)) return;
  if (request.operation === 'input' && entry?.stopping) return;
  if (!entry || entry.stopping) throw new Error(message('runInvalid'));
  if (request.operation === 'input') {
    const { data } = request.value;
    if (data.length > 1024 * 1024) throw new Error(message('terminalInputInvalid'));
    entry.terminal.write(data);
  } else if (request.operation === 'resize') {
    const { cols, rows } = request.value;
    if (![cols, rows].every(n => Number.isInteger(n) && n >= 1 && n <= 1000))
      throw new Error(message('terminalSizeInvalid'));
    entry.terminal.resize(cols, rows);
  } else await stop(request.value.runId);
}

let requests = Promise.resolve();
process.on('message', (received: unknown) => {
  const parsed = hostRequestSchema.safeParse(received);
  if (!parsed.success) {
    const id = requestIdOf(received);
    if (id !== undefined) send({ kind: 'error', id, message: message('terminalRequestInvalid') });
    else console.error(message('terminalRequestInvalid'));
    return;
  }
  const request = parsed.data;
  if (request.operation === 'output-consumed') {
    const entry = runs.get(request.value.runId);
    const { characters } = request.value;
    if (entry && Number.isInteger(characters) && characters > 0 && characters <= entry.unacknowledgedOutput) {
      entry.unacknowledgedOutput -= characters;
      if (entry.paused && entry.unacknowledgedOutput < 64 * 1024) {
        entry.paused = false;
        entry.terminal.resume();
      }
    }
    return;
  }
  requests = requests.then(async () => {
    try {
      send({ kind: 'reply', id: request.id, result: await performOperation(request) });
    } catch (error) {
      send({ kind: 'error', id: request.id, message: errorMessage(error) });
    }
    if (request.operation === 'shutdown' && process.connected) process.disconnect?.();
  });
});
process.on('disconnect', () => {
  const unexpected = !shuttingDown;
  void (async () => {
    let cleanupError: unknown;
    try {
      await shutdown();
    } catch (error) {
      cleanupError = error;
    }
    if (unexpected)
      await recordFailure(
        workbenchVariable('VIBEBRIDGE_FAULT_FILE'),
        'main',
        message('mainDisconnected'),
        cleanupError,
      );
    else if (cleanupError) console.error(cleanupError);
  })()
    .catch(error => console.error(message('failureRecordFailed', { reason: nestedMessage(error.message) })))
    .finally(() => process.exit());
});
