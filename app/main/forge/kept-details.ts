import type { DetailItem, DetailResult } from '../../shared/forge/sidebar-data';

const detailsKept = 50;

const keyOf = (projectId: string, { kind, number }: DetailItem) => `${projectId}\n${kind}\n${number}`;

export class KeptDetails {
  private answers = new Map<string, DetailResult>();
  private unopened = new Set<string>();
  private readsAhead = new Map<string, Promise<DetailResult>>();

  holds(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    return this.answers.has(key) || this.readsAhead.has(key);
  }
  use(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    const kept = this.answers.get(key);
    if (kept) {
      this.answers.delete(key);
      this.answers.set(key, kept);
    }
    return kept;
  }
  keep(projectId: string, item: DetailItem, result: DetailResult) {
    const key = keyOf(projectId, item);
    this.answers.delete(key);
    this.answers.set(key, result);
    for (const oldest of this.answers.keys()) {
      if (this.answers.size <= detailsKept) break;
      this.answers.delete(oldest);
      this.unopened.delete(oldest);
    }
  }
  async readAhead(projectId: string, item: DetailItem, read: Promise<DetailResult>) {
    const key = keyOf(projectId, item);
    this.readsAhead.set(key, read);
    const result = await read;
    if (this.readsAhead.get(key) !== read) return;
    this.readsAhead.delete(key);
    if (!result.ok) return;
    this.keep(projectId, item, result);
    this.unopened.add(key);
  }
  openUnopened(projectId: string, item: DetailItem) {
    return this.unopened.delete(keyOf(projectId, item));
  }
  takeReadAhead(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    const read = this.readsAhead.get(key);
    this.readsAhead.delete(key);
    return read;
  }
  drop(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    this.answers.delete(key);
    this.unopened.delete(key);
    this.readsAhead.delete(key);
  }
  forget(projectId: string) {
    const ofProject = (key: string) => key.startsWith(`${projectId}\n`);
    for (const key of this.answers.keys()) if (ofProject(key)) this.answers.delete(key);
    for (const key of this.unopened) if (ofProject(key)) this.unopened.delete(key);
    for (const key of this.readsAhead.keys()) if (ofProject(key)) this.readsAhead.delete(key);
  }
}
