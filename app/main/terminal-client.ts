import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentCommand, CommandCheck, Run, TerminalEvent } from '../shared/model';
import { stopProcesses, type ProcessIdentity } from '../terminal/processes';
import { recordFailure } from '../terminal/failure';

export class TerminalClient {
  private child: ChildProcess;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private processes: ProcessIdentity[] = [];
  private closing = false;
  private failure?: Error;
  private owner = randomUUID();
  private cleanup?: Promise<void>;
  private exited: Promise<void>;
  constructor(directory: string, onEvent: (event: TerminalEvent) => void, onFailure: (message: string, stopped?: boolean) => void) {
    const faultFile = join(directory, 'last-failure.json');
    this.child = fork(join(__dirname, 'terminal.cjs'), [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VIBEBRIDGE_HOST_OWNER: this.owner, VIBEBRIDGE_FAULT_FILE: faultFile }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.exited = new Promise(resolve => this.child.once('exit', () => resolve()));
    this.child.on('message', (message: any) => {
      if (this.failure) return;
      if (message.event) onEvent(message.event);
      else if (message.processes) this.processes = message.processes;
      else if (message.failure) onFailure(message.failure);
      else {
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer); this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
      }
    });
    const fail = (error: Error) => {
      if (this.failure) return;
      this.failure = error;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (!this.closing) {
        onFailure(error.message, true);
        this.cleanup = (async () => {
          let cleanupError: unknown;
          try { await stopProcesses(this.processes, this.owner); }
          catch (error) { cleanupError = error; onFailure((error as Error).message); }
          await recordFailure(faultFile, 'terminal', error.message, cleanupError);
        })().catch(error => onFailure(`故障记录保存失败：${error.message}`));
      }
    };
    this.child.on('error', fail);
    this.child.on('exit', (code, signal) => fail(new Error(`终端管理进程已结束（${signal ?? `退出码 ${code}`}）`)));
  }
  private request<T>(operation: string, value?: unknown): Promise<T> {
    if (this.closing && operation !== 'shutdown') return Promise.reject(new Error('工作台正在退出'));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('终端操作超时')); }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.send({ id, operation, value }, error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  start(value: { id: string; panelId: string; projectId: string; directory: string; command: AgentCommand; integration: Record<string, string> }) { return this.request<Run>('start', value); }
  checkCommand(command: string) { return this.request<CommandCheck>('check-command', command); }
  input(runId: string, data: string) { return this.request<void>('input', { runId, data }); }
  resize(runId: string, cols: number, rows: number) { return this.closing ? Promise.resolve() : this.request<void>('resize', { runId, cols, rows }); }
  stop(runId: string) { return this.request<void>('stop', { runId }); }
  acknowledgeOutput(runId: string, characters: number) {
    if (!this.failure && this.child.connected) {
      this.child.send({ operation: 'output-consumed', value: { runId, characters } }, () => {});
    }
  }
  async shutdown() {
    this.closing = true;
    try {
      await this.request('shutdown');
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([this.exited, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('终端管理进程退出超时')), 1000);
        })]);
      } finally { clearTimeout(timer); }
    } catch (error) {
      this.child.kill('SIGKILL');
      await this.cleanup;
      await stopProcesses(this.processes, this.owner);
      throw error;
    }
  }
}
