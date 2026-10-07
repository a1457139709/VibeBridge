import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import type { AgentCommand, Run, TerminalEvent } from '../shared/model';
import { stopProcesses, type ProcessIdentity } from '../terminal/processes';

export class TerminalClient {
  private child: ChildProcess;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private sequence = 0;
  private processes: ProcessIdentity[] = [];
  private closing = false;
  private failure?: Error;
  constructor(onEvent: (event: TerminalEvent) => void, onFailure: (message: string) => void) {
    this.child = fork(join(__dirname, 'terminal.cjs'), [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.child.on('message', (message: any) => {
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
      this.failure = error;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
      this.pending.clear();
      if (!this.closing) {
        onFailure('终端管理进程已结束');
        void stopProcesses(this.processes).catch(error => onFailure(error.message));
      }
    };
    this.child.on('error', fail);
    this.child.on('exit', () => fail(new Error('终端管理进程已结束')));
  }
  private request<T>(operation: string, value?: unknown): Promise<T> {
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
  start(value: { id: string; panelId: string; projectId: string; directory: string; command: AgentCommand }) { return this.request<Run>('start', value); }
  input(runId: string, data: string) { return this.request<void>('input', { runId, data }); }
  resize(runId: string, cols: number, rows: number) { return this.request<void>('resize', { runId, cols, rows }); }
  stop(runId: string) { return this.request<void>('stop', { runId }); }
  async shutdown() {
    this.closing = true;
    try { await this.request('shutdown'); }
    catch (error) { await stopProcesses(this.processes); throw error; }
    finally { this.child.kill(); }
  }
}
