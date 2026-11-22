import { message, nestedMessage } from '../../shared/messages';
import { Worker } from 'node:worker_threads';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  agentTypeSchema,
  layoutSchema,
  sidebarPreferencesSchema,
  type Sidebar,
  type SidebarPreferences,
  type Project,
} from '../../shared/model';
import { repositoryReferenceSchema, type RepositoryReference } from '../../shared/forge/forge';
import type { DispatchRecord } from '../dispatch';

/** A request the Project Store sends its storage worker, named by its operation. */
export type StorageRequest =
  | { operation: 'load' }
  | { operation: 'save'; project: Project }
  | { operation: 'bind'; projectId: string; repository: RepositoryReference }
  | { operation: 'unbind'; projectId: string }
  | { operation: 'dispatch'; record: DispatchRecord }
  | { operation: 'sidebar'; sidebar: Sidebar; preferences: SidebarPreferences }
  | { operation: 'delete'; projectId: string; nextActiveProjectId: string | null }
  | { operation: 'active'; projectId: string }
  | { operation: 'close' };

const projectSchema: z.ZodType<Project> = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  panels: z.array(z.object({ id: z.string(), agent: agentTypeSchema })),
  layout: layoutSchema.nullable(),
});
const dispatchRecordSchema: z.ZodType<DispatchRecord> = z.object({
  projectId: z.string(),
  repository: repositoryReferenceSchema,
  issue: z.number(),
  dispatchedAt: z.string(),
  agent: agentTypeSchema,
  skill: z.string(),
  text: z.string(),
  sessionId: z.string(),
});
/** What a load reads from the store: the projects, each one's Repository Binding, the Dispatch Records, the
 * active project, and each sidebar's preferences. */
const storedContentSchema = z.object({
  projects: z.array(projectSchema),
  bindings: z.record(z.string(), repositoryReferenceSchema),
  dispatches: z.array(dispatchRecordSchema),
  activeProjectId: z.string().nullable(),
  navigation: sidebarPreferencesSchema,
  forgeSidebar: sidebarPreferencesSchema,
}) satisfies z.ZodType<Record<Sidebar, SidebarPreferences>>;
export type StoredContent = z.infer<typeof storedContentSchema>;
/** The result of a request that writes: its completion. */
const completionSchema = z.void();

/** The storage worker's reply to the request under `id`: its result, or the message of the error it failed with. */
const storageReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('result'), id: z.number(), result: z.unknown().optional() }),
  z.object({ kind: z.literal('error'), id: z.number(), message: z.string() }),
]);
export type StorageReply = z.infer<typeof storageReplySchema>;

/** A request waiting for its reply: `settle` reads the reply's result by the schema its request expects. */
interface PendingRequest {
  settle(result: unknown): void;
  reject(error: Error): void;
}

export class ProjectStore {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private failure?: Error;
  private constructor(directory: string) {
    this.worker = new Worker(join(__dirname, 'storage.cjs'), {
      workerData: { file: join(directory, 'projects.sqlite') },
    });
    const failed = (error: Error) => {
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.worker.on('message', (received: unknown) => {
      const reply = storageReplySchema.safeParse(received);
      if (!reply.success) {
        failed(new Error(message('storageReplyInvalid')));
        return;
      }
      const { data } = reply;
      const request = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.kind === 'error')
        request?.reject(new Error(message('projectStorageFailed', { reason: nestedMessage(data.message) })));
      else request?.settle(data.result);
    });
    this.worker.on('error', failed);
    this.worker.on('exit', () => failed(new Error(message('projectStorageClosed'))));
  }
  static async open(directory: string) {
    await mkdir(directory, { recursive: true });
    return new ProjectStore(directory);
  }
  /** Sends `request` and resolves with the worker's result as `result` reads it. */
  private request<T>(request: StorageRequest, result: z.ZodType<T>): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const settle = (value: unknown) => {
        const parsed = result.safeParse(value);
        if (parsed.success) resolve(parsed.data);
        else reject(new Error(message('storageReplyInvalid')));
      };
      this.pending.set(id, { settle, reject });
      this.worker.postMessage({ id, request });
    });
  }
  /** Sends a request that writes; it resolves once the write completed. */
  private write(request: StorageRequest) {
    return this.request(request, completionSchema);
  }
  load() {
    return this.request({ operation: 'load' }, storedContentSchema);
  }
  save(project: Project) {
    return this.write({ operation: 'save', project });
  }
  /** Stores a project's Repository Binding, replacing any it has. */
  bind(projectId: string, repository: RepositoryReference) {
    return this.write({ operation: 'bind', projectId, repository });
  }
  /** Removes a project's Repository Binding. */
  unbind(projectId: string) {
    return this.write({ operation: 'unbind', projectId });
  }
  /** Appends a Dispatch Record. */
  appendDispatchRecord(record: DispatchRecord) {
    return this.write({ operation: 'dispatch', record });
  }
  saveSidebar(sidebar: Sidebar, preferences: SidebarPreferences) {
    return this.write({ operation: 'sidebar', sidebar, preferences });
  }
  deleteProject(id: string, nextActiveProjectId: string | null) {
    return this.write({ operation: 'delete', projectId: id, nextActiveProjectId });
  }
  saveActiveProject(id: string) {
    return this.write({ operation: 'active', projectId: id });
  }
  async close() {
    try {
      await this.write({ operation: 'close' });
    } finally {
      await this.worker.terminate();
    }
  }
}
