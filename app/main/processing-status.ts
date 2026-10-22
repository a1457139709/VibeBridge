import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AgentType, Project, Run } from '../shared/model';
import type { AttentionState, AttentionGroup, ProcessingProjection, ProcessingState } from '../shared/processing-status';
import { interpretStatus, type StatusMemory } from './status-events';

interface Observation {
  agent: AgentType; token: string; since: number; accepting: boolean; running: boolean;
  state?: ProcessingState; sequence?: number; occurredAt?: number; ids: Set<string>; memory: StatusMemory;
}

/** Run-scoped ingestion and projection; see docs/processing-status.md for the wire contract.
 * prepare precedes launch, lifecycle uses only terminal-host facts. Reports during startup
 * are retained but invisible until running. Stopping revokes credentials; no result persists.
 * A running instance without a reliable observation is Error, never inferred from PTY data.
 * The callback publishes a complete Workbench snapshot after an accepted visible change.
 */
export class ProcessingStatus {
  private observations = new Map<string, Observation>();
  private server?: Server;
  private endpoint?: Promise<string>;
  constructor(private changed: () => void) {}

  async prepare(runId: string, agent: AgentType): Promise<Record<string, string>> {
    const observation: Observation = { agent, token: randomUUID(), since: Date.now(), accepting: true, running: false, ids: new Set(), memory: {} };
    this.observations.set(runId, observation);
    try {
      const url = await (this.endpoint ??= this.listen());
      return { VIBEBRIDGE_STATUS_CONTEXT: JSON.stringify({ url, runId, agent, token: observation.token }) };
    } catch { return {}; } // Observation must never prevent a terminal launch.
  }

  lifecycle(run: Run) {
    const observation = this.observations.get(run.id);
    if (!observation) return;
    observation.running = run.state === 'running';
    if (run.state === 'failed' || run.state === 'stopped') this.forget(run.id);
  }
  stopping(runId: string) { const observation = this.observations.get(runId); if (observation) observation.accepting = false; }
  forget(runId: string) { this.observations.delete(runId); }

  project(projects: Project[], runs: Run[]): ProcessingProjection {
    const projection: ProcessingProjection = { runs: {}, projects: {} };
    for (const project of projects) {
      const groups: Record<AttentionState, AttentionGroup> = projection.projects[project.id] = {
        'needs-input': { count: 0, members: [] }, done: { count: 0, members: [] }, error: { count: 0, members: [] },
      };
      for (const panel of project.panels) {
        const run = runs.find(run => run.panelId === panel.id && run.projectId === project.id && run.state === 'running');
        if (!run) continue;
        const state = this.observations.get(run.id)?.state ?? 'error';
        projection.runs[run.id] = state;
        if (state === 'needs-input' || state === 'done' || state === 'error') {
          groups[state].members.push({ panelId: panel.id, runId: run.id });
          groups[state].count++;
        }
      }
    }
    return projection;
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
        for (const observation of this.observations.values()) { observation.state = 'error'; observation.memory = {}; }
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
    if (event.version !== 1 || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)
      || (event.scope !== 'main' && event.scope !== 'child')) return 400;
    if (event.scope === 'child') return 204;
    if (event.id !== undefined && (typeof event.id !== 'string' || !event.id || event.id.length > 256)) return 400;
    if (event.sequence !== undefined && (typeof event.sequence !== 'number' || !Number.isSafeInteger(event.sequence) || event.sequence < 0)) return 400;
    for (const field of ['occurredAt', 'expiresAt']) {
      if (event[field] !== undefined && (typeof event[field] !== 'number' || !Number.isFinite(event[field]))) return 400;
    }
    if ((typeof event.id === 'string' && observation.ids.has(event.id))
      || (typeof event.sequence === 'number' && observation.sequence !== undefined && event.sequence <= observation.sequence)
      || (typeof event.occurredAt === 'number' && event.occurredAt < observation.since)
      || (typeof event.occurredAt === 'number' && observation.occurredAt !== undefined && event.occurredAt < observation.occurredAt)
      || (typeof event.expiresAt === 'number' && event.expiresAt <= Date.now())) return 204;
    if (typeof event.id === 'string') observation.ids.add(event.id);
    if (typeof event.sequence === 'number') observation.sequence = event.sequence;
    if (typeof event.occurredAt === 'number') observation.occurredAt = event.occurredAt;
    const payload = event.payload as Record<string, unknown>;
    const state = interpretStatus(observation.agent, payload, observation.memory);
    if (state === 'error') observation.memory = {};
    if (state !== 'keep' && observation.state !== state) {
      observation.state = state;
      if (observation.running) this.changed();
    }
    return 204;
  }

  async close() {
    this.observations.clear();
    const server = this.server;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
