import { message, detail } from '../shared/messages';
import { Worker } from 'node:worker_threads';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Sidebar, SidebarPreferences, Project } from '../shared/model';
import type { RepositoryReference } from '../shared/forge';
import type { DispatchRecord } from './dispatch';

export class ProjectStore {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private failure?: Error;
  private constructor(directory: string) {
    this.worker = new Worker(join(__dirname, 'storage.cjs'), { workerData: { file: join(directory, 'projects.sqlite') } });
    this.worker.on('message', ({ id, result, error }) => {
      const request = this.pending.get(id); this.pending.delete(id);
      if (error) request?.reject(new Error(message('projectStorageFailed', { reason: detail(error) }))); else request?.resolve(result);
    });
    const failed = (error: Error) => {
      this.failure = error;
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.worker.on('error', failed);
    this.worker.on('exit', () => failed(new Error(message('projectStorageClosed'))));
  }
  static async open(directory: string) { await mkdir(directory, { recursive: true }); return new ProjectStore(directory); }
  private request<T>(operation: string, value?: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.sequence; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, operation, value });
    });
  }
  load() { return this.request<{ projects: Project[]; repositories: Record<string, RepositoryReference>; dispatches: DispatchRecord[]; activeProjectId: string | null; } & Record<Sidebar, SidebarPreferences>>('load'); }
  save(project: Project) { return this.request<void>('save', project); }
  /** Saves an edited project and its Repository Binding (null for none) in one transaction. */
  edit(project: Project, repository: RepositoryReference | null) { return this.request<void>('edit', { project, repository }); }
  /** Appends a Dispatch Record. */
  dispatch(record: DispatchRecord) { return this.request<void>('dispatch', record); }
  sidebar(sidebar: Sidebar, preferences: SidebarPreferences) { return this.request<void>('sidebar', { sidebar, preferences }); }
  delete(id: string, activeProjectId: string | null) { return this.request<void>('delete', { id, activeProjectId }); }
  active(id: string) { return this.request<void>('active', id); }
  async close() { try { await this.request('close'); } finally { await this.worker.terminate(); } }
}
