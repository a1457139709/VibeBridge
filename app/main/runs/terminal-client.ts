import { message, nestedMessage } from '../../shared/messages';
import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TerminalEvent } from '../../shared/model';
import { stopProcesses, type ProcessIdentity } from '../../terminal/processes';
import { recordFailure } from '../../terminal/failure';
import { errorMessage } from '../../shared/caught-error';
import {
  commandCheckSchema,
  completionSchema,
  hostReportSchema,
  runSchema,
  type HostOperation,
  type HostRequest,
  type RunStart,
} from '../../terminal/protocol';
import type { z } from 'zod';

type Operation = WithoutId<HostOperation>;
type WithoutId<O> = O extends unknown ? Omit<O, 'id'> : never;
interface PendingRequest {
  settle(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

export class TerminalClient {
  private child: ChildProcess;
  private pending = new Map<number, PendingRequest>();
  private sequence = 0;
  private processes: ProcessIdentity[] = [];
  private closing = false;
  private failure?: Error;
  private owner = randomUUID();
  private cleanup?: Promise<void>;
  private exited: Promise<void>;
  constructor(
    dataDirectory: string,
    onEvent: (event: TerminalEvent) => void,
    onFailure: (message: string, stopped?: boolean) => void,
  ) {
    const faultFile = join(dataDirectory, 'last-failure.json');
    this.child = fork(join(__dirname, 'terminal.cjs'), [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        VIBEBRIDGE_HOST_OWNER: this.owner,
        VIBEBRIDGE_FAULT_FILE: faultFile,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.exited = new Promise(resolve => this.child.once('exit', () => resolve()));
    this.child.on('message', (received: unknown) => {
      if (this.failure) return;
      const report = hostReportSchema.safeParse(received);
      if (!report.success) {
        onFailure(message('terminalReportInvalid'));
        return;
      }
      const { data } = report;
      if (data.kind === 'event') onEvent(data.event);
      else if (data.kind === 'processes') this.processes = data.processes;
      else if (data.kind === 'failure') onFailure(data.message);
      else {
        const request = this.pending.get(data.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(data.id);
        if (data.kind === 'error') request.reject(new Error(data.message));
        else request.settle(data.result);
      }
    });
    const fail = (error: Error) => {
      if (this.failure) return;
      this.failure = error;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
      if (!this.closing) {
        onFailure(error.message, true);
        this.cleanup = (async () => {
          let cleanupError: unknown;
          try {
            await stopProcesses(this.processes, this.owner);
          } catch (error) {
            cleanupError = error;
            onFailure(errorMessage(error));
          }
          await recordFailure(faultFile, 'terminal', error.message, cleanupError);
        })().catch(error => onFailure(message('failureRecordFailed', { reason: nestedMessage(error.message) })));
      }
    };
    this.child.on('error', fail);
    this.child.on('exit', (code, signal) =>
      fail(
        new Error(
          message('terminalHostExited', { reason: signal ?? nestedMessage(message('exitCode', { code: code ?? '' })) }),
        ),
      ),
    );
  }
  private request<T>(operation: Operation, result: z.ZodType<T>): Promise<T> {
    if (this.closing && operation.operation !== 'shutdown') return Promise.reject(new Error(message('quitting')));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(message('terminalTimeout')));
      }, 10000);
      const settle = (value: unknown) => {
        const parsed = result.safeParse(value);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error(message('terminalReportInvalid')));
      };
      this.pending.set(id, { settle, reject, timer });
      this.send({ ...operation, id }, error => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }
  private send(request: HostRequest, sent: (error: Error | null) => void) {
    this.child.send(request, sent);
  }
  start(value: RunStart) {
    return this.request({ operation: 'start', value }, runSchema);
  }
  checkCommand(command: string) {
    return this.request({ operation: 'check-command', value: command }, commandCheckSchema);
  }
  input(runId: string, data: string) {
    return this.request({ operation: 'input', value: { runId, data } }, completionSchema);
  }
  resize(runId: string, cols: number, rows: number) {
    return this.closing
      ? Promise.resolve()
      : this.request({ operation: 'resize', value: { runId, cols, rows } }, completionSchema);
  }
  stop(runId: string) {
    return this.request({ operation: 'stop', value: { runId } }, completionSchema);
  }
  acknowledgeOutput(runId: string, characters: number) {
    if (!this.failure && this.child.connected) {
      this.send({ operation: 'output-consumed', value: { runId, characters } }, () => {});
    }
  }
  async shutdown() {
    this.closing = true;
    try {
      await this.request({ operation: 'shutdown' }, completionSchema);
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          this.exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message('terminalQuitTimeout'))), 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.child.kill('SIGKILL');
      await this.cleanup;
      await stopProcesses(this.processes, this.owner);
      throw error;
    }
  }
}
