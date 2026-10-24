import { message, detail } from '../shared/messages';
import { Worker } from 'node:worker_threads';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NavigationPreferences, Project } from '../shared/model';

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
  load() { return this.request<{ projects: Project[]; activeProjectId: string | null; navigation: NavigationPreferences }>('load'); }
  save(project: Project) { return this.request<void>('save', project); }
  navigation(value: NavigationPreferences) { return this.request<void>('navigation', value); }
  delete(id: string, activeProjectId: string | null) { return this.request<void>('delete', { id, activeProjectId }); }
  active(id: string) { return this.request<void>('active', id); }
  async close() { try { await this.request('close'); } finally { await this.worker.terminate(); } }
}
