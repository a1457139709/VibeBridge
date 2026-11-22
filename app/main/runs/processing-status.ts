import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServer, type Server } from 'node:http';
import type { AgentCommand, AgentType, Run } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';
import type { StatusAdapter, StatusInterpreter } from '../agent-status/adapter';
import { codex } from '../agent-status/codex/status';
import { claude } from '../agent-status/claude/status';
import { pi } from '../agent-status/pi/status';
import { message, nestedMessage } from '../../shared/messages';
import { errorMessage } from '../../shared/caught-error';

const adapters: Record<AgentType, StatusAdapter> = { codex, claude, pi };

const report = z.looseObject({ payload: z.unknown() });
const launchCredentials = z.looseObject({ runId: z.string(), token: z.string(), agent: z.string() });
const reportPayload = z.union([
  z.looseObject({ observation: z.literal('lost') }),
  z.record(z.string(), z.unknown()).refine(payload => !('observation' in payload)),
]);

export type SessionReceiver = (sessionId: string) => void;

interface SessionWait {
  handOver: SessionReceiver;
  onReleased?: () => void;
}

interface Observation {
  agent: AgentType;
  token: string;
  accepting: boolean;
  running: boolean;
  state?: ProcessingState;
  sessionId?: string;
  interpreter: StatusInterpreter;
  sessionWaits: SessionWait[];
  reportedReady: boolean;
  readyWaits: (() => void)[];
  cleanup?: () => Promise<void>;
}

export class ProcessingStatus {
  private observations = new Map<string, Observation>();
  private server?: Server;
  private endpoint?: Promise<string>;
  private cleanups = new Set<Promise<void>>();
  constructor(
    private changed: () => void,
    private resourceDirectory: string,
  ) {}

  async prepare(
    runId: string,
    agent: AgentType,
    command: AgentCommand,
    directory: string,
  ): Promise<{ command: AgentCommand; extraEnvironment: Record<string, string> }> {
    const observation: Observation = {
      agent,
      token: randomUUID(),
      accepting: true,
      running: false,
      sessionWaits: [],
      reportedReady: false,
      readyWaits: [],
      interpreter: adapters[agent].createInterpreter(),
    };
    this.observations.set(runId, observation);
    try {
      const url = await (this.endpoint ??= this.listen());
      const prepared = await adapters[agent].prepare({ command, directory, resourceDirectory: this.resourceDirectory });
      observation.cleanup = prepared.cleanup;
      return {
        command: prepared.command,
        extraEnvironment: {
          VIBEBRIDGE_STATUS_CONTEXT: JSON.stringify({ url, runId, agent, token: observation.token }),
        },
      };
    } catch {
      return { command, extraEnvironment: {} };
    }
  }

  trackRunState(run: Run) {
    const observation = this.observations.get(run.id);
    if (!observation) return;
    observation.running = run.state === 'running';
    if (run.state === 'failed' || run.state === 'stopped') this.release(run.id);
  }
  stopAccepting(runId: string) {
    const observation = this.observations.get(runId);
    if (observation) observation.accepting = false;
  }
  release(runId: string) {
    const observation = this.observations.get(runId);
    this.observations.delete(runId);
    for (const wait of observation?.sessionWaits.splice(0) ?? []) wait.onReleased?.();
    if (observation?.cleanup) {
      const task = observation.cleanup();
      this.cleanups.add(task);
      void task.then(
        () => this.cleanups.delete(task),
        () => {},
      );
    }
  }

  sessionId(runId: string) {
    return this.observations.get(runId)?.sessionId;
  }

  awaitFirstSession(runId: string, handOver: SessionReceiver, onReleased?: () => void) {
    const observation = this.observations.get(runId);
    if (!observation) return false;
    if (observation.sessionId) handOver(observation.sessionId);
    else observation.sessionWaits.push({ handOver, onReleased });
    return true;
  }

  awaitFirstReady(runId: string, onFirstReady: () => void) {
    const observation = this.observations.get(runId);
    if (!observation) return false;
    if (observation.reportedReady) onFirstReady();
    else observation.readyWaits.push(onFirstReady);
    return true;
  }

  status(run: Run): ProcessingState | undefined {
    return run.state === 'running' ? (this.observations.get(run.id)?.state ?? 'error') : undefined;
  }

  private listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = (this.server = createServer((request, response) => {
        if (request.method !== 'POST' || request.url !== '/events') {
          response.writeHead(404).end();
          return;
        }
        let body = '',
          size = 0;
        request.setEncoding('utf8');
        request.on('error', () => {});
        request.on('data', chunk => {
          size += Buffer.byteLength(chunk);
          if (size > 64 * 1024) {
            response.writeHead(413).end();
            request.destroy();
          } else body += chunk;
        });
        request.on('end', () => {
          if (size > 64 * 1024) return;
          try {
            response.writeHead(this.receive(JSON.parse(body))).end();
          } catch {
            response.writeHead(400).end();
          }
        });
      }));
      server.requestTimeout = 5000;
      server.on('error', error => {
        reject(error);
        for (const observation of this.observations.values()) {
          observation.state = 'error';
          observation.interpreter.discardEvidence();
        }
        this.changed();
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') resolve(`http://127.0.0.1:${address.port}/events`);
      });
    });
  }

  private receive(value: unknown): number {
    const event = report.safeParse(value);
    if (!event.success) return 400;
    const credentials = launchCredentials.safeParse(event.data);
    const observation = credentials.success ? this.observations.get(credentials.data.runId) : undefined;
    if (
      !credentials.success ||
      !observation?.accepting ||
      credentials.data.token !== observation.token ||
      credentials.data.agent !== observation.agent
    )
      return 403;
    const parsed = reportPayload.safeParse(event.data.payload);
    if (!parsed.success) return 400;
    const payload = parsed.data;
    const state = 'observation' in payload ? 'error' : observation.interpreter.accept(payload);
    const session = observation.interpreter.sessionId();
    let visible = session !== observation.sessionId;
    observation.sessionId = session;
    if (state === 'error') observation.interpreter.discardEvidence();
    if (state !== 'keep' && state !== 'discard' && observation.state !== state) {
      observation.state = state;
      visible = true;
    }
    if (visible && observation.running) this.changed();
    if (session) for (const { handOver } of observation.sessionWaits.splice(0)) handOver(session);
    if (state === 'ready') {
      observation.reportedReady = true;
      for (const ready of observation.readyWaits.splice(0)) ready();
    }
    return 204;
  }

  async close() {
    for (const runId of this.observations.keys()) this.release(runId);
    const server = this.server;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const results = await Promise.allSettled(this.cleanups);
    const failures = results.flatMap(result => (result.status === 'rejected' ? [result.reason] : []));
    if (failures.length)
      throw new AggregateError(
        failures,
        message('statusCleanupFailed', {
          reasons: failures.map(error => nestedMessage(errorMessage(error))),
        }),
      );
  }
}
