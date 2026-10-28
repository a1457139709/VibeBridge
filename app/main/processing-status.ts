import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AgentCommand, AgentType, Run } from '../shared/model';
import type { ProcessingState } from '../shared/processing-status';
import type { StatusAdapter, StatusInterpreter } from './agent-status/adapter';
import { codex } from './agent-status/codex/status';
import { claude } from './agent-status/claude/status';
import { pi } from './agent-status/pi/status';
import { message, detail } from '../shared/messages';

// CLI protocol differences stay behind this closed table.
const adapters: Record<AgentType, StatusAdapter> = { codex, claude, pi };

interface Observation {
  agent: AgentType; token: string; accepting: boolean; running: boolean;
  state?: ProcessingState; interpreter: StatusInterpreter;
  cleanup?: () => Promise<void>;
}

/** Run-scoped ingestion and display state; see docs/processing-status.md for the report format.
 * prepare precedes launch, lifecycle uses only terminal-host facts. Reports during startup
 * are retained but invisible until running. Stopping revokes credentials; no result persists.
 * A running instance without a reliable observation is Error, never inferred from PTY data.
 * The callback publishes a complete Workbench snapshot after an accepted visible change.
 */
export class ProcessingStatus {
  private observations = new Map<string, Observation>();
  private server?: Server;
  private endpoint?: Promise<string>;
  private cleanups = new Set<Promise<void>>();
  constructor(private changed: () => void, private resourceDirectory: string) {}

  async prepare(runId: string, agent: AgentType, command: AgentCommand, directory: string) {
    const observation: Observation = { agent, token: randomUUID(), accepting: true, running: false,
      interpreter: adapters[agent].observe() };
    this.observations.set(runId, observation);
    try {
      const url = await (this.endpoint ??= this.listen());
      const prepared = await adapters[agent].prepare({ command, directory, resourceDirectory: this.resourceDirectory });
      observation.cleanup = prepared.cleanup;
      return { command: prepared.command,
        integration: { VIBEBRIDGE_STATUS_CONTEXT: JSON.stringify({ url, runId, agent, token: observation.token }) } };
    } catch { return { command, integration: {} as Record<string, string> }; } // Observation must never prevent a terminal launch.
  }

  lifecycle(run: Run) {
    const observation = this.observations.get(run.id);
    if (!observation) return;
    observation.running = run.state === 'running';
    if (run.state === 'failed' || run.state === 'stopped') this.forget(run.id);
  }
  stopping(runId: string) { const observation = this.observations.get(runId); if (observation) observation.accepting = false; }
  forget(runId: string) {
    const observation = this.observations.get(runId);
    this.observations.delete(runId);
    if (observation?.cleanup) {
      const task = observation.cleanup();
      this.cleanups.add(task);
      // Retain failures for close() to report, without interrupting host events.
      void task.then(() => this.cleanups.delete(task), () => {});
    }
  }

  /** The processing state the run displays: only a running instance has one. */
  status(run: Run): ProcessingState | undefined {
    return run.state === 'running' ? this.observations.get(run.id)?.state ?? 'error' : undefined;
  }

  private listen(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = this.server = createServer((request, response) => {
        if (request.method !== 'POST' || request.url !== '/events') { response.writeHead(404).end(); return; }
        let body = '', size = 0;
        request.setEncoding('utf8');
        request.on('error', () => {});
        request.on('data', chunk => {
          size += Buffer.byteLength(chunk);
          if (size > 64 * 1024) { response.writeHead(413).end(); request.destroy(); }
          else body += chunk;
        });
        request.on('end', () => {
          if (size > 64 * 1024) return;
          try { response.writeHead(this.receive(JSON.parse(body))).end(); }
          catch { response.writeHead(400).end(); }
        });
      });
      server.requestTimeout = 5000;
      server.on('error', error => {
        reject(error);
        for (const observation of this.observations.values()) { observation.state = 'error'; observation.interpreter.discardEvidence(); }
        this.changed();
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address !== 'string') resolve(`http://127.0.0.1:${address.port}/events`);
      });
    });
  }

  private receive(value: unknown): number {
    if (!value || typeof value !== 'object') return 400;
    const event = value as Record<string, unknown>;
    const observation = typeof event.runId === 'string' ? this.observations.get(event.runId) : undefined;
    // Authenticate this launch before interpreting even an unfamiliar event.
    if (!observation?.accepting || event.token !== observation.token || event.agent !== observation.agent) return 403;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return 400;
    // Observation loss belongs to the Status Reporter transport; adapters see only CLI facts.
    const payload = event.payload as Record<string, unknown>;
    if ('observation' in payload && payload.observation !== 'lost' && payload.observation !== 'unavailable') return 400;
    const state = 'observation' in payload ? 'error' : observation.interpreter.accept(payload);
    if (state === 'discard') return 204;
    if (state === 'error') observation.interpreter.discardEvidence();
    if (state !== 'keep' && observation.state !== state) {
      observation.state = state;
      if (observation.running) this.changed();
    }
    return 204;
  }

  async close() {
    for (const runId of this.observations.keys()) this.forget(runId);
    const server = this.server;
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    const results = await Promise.allSettled(this.cleanups);
    const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, message('statusCleanupFailed', {
      reasons: failures.map(error => detail(error instanceof Error ? error.message : String(error))),
    }));
  }
}
