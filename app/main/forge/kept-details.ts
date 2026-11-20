import type { DetailItem, DetailResult } from '../../shared/forge/sidebar-data';

/** The details kept across all projects, the most recently used. */
const detailsKept = 50;

const keyOf = (projectId: string, { kind, number }: DetailItem) => `${projectId}\n${kind}\n${number}`;

/** The Forge sidebar's kept details (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md): the answers of the
 * 50 details used last across projects, which of them were read ahead and not opened since, and the reads ahead still
 * on their way. */
export class KeptDetails {
  private answers = new Map<string, DetailResult>();
  private unopened = new Set<string>();
  private readsAhead = new Map<string, Promise<DetailResult>>();

  /** Whether an answer for the item is kept, or being read ahead. */
  holds(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    return this.answers.has(key) || this.readsAhead.has(key);
  }
  /** The kept answer for the item, now the most recently used; undefined when none is kept. */
  use(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    const kept = this.answers.get(key);
    if (kept) {
      this.answers.delete(key);
      this.answers.set(key, kept);
    }
    return kept;
  }
  /** Keeps the answer as the most recently used, dropping the one used longest ago beyond the limit. */
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
  /** Holds `read`, a read ahead of the item, so opening the item waits for it. Its answer is kept as not opened, unless
   * it is a failure or the read was taken or dropped meanwhile. */
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
  /** The item is opened: true when its kept answer was read ahead and not opened since, so it needs no read. */
  openUnopened(projectId: string, item: DetailItem) {
    return this.unopened.delete(keyOf(projectId, item));
  }
  /** The read ahead of the item still on its way, which the opening detail now takes; undefined when none is. */
  takeReadAhead(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    const read = this.readsAhead.get(key);
    this.readsAhead.delete(key);
    return read;
  }
  /** Drops what is kept of the item, its read ahead still on its way too: what it holds changed. */
  drop(projectId: string, item: DetailItem) {
    const key = keyOf(projectId, item);
    this.answers.delete(key);
    this.unopened.delete(key);
    this.readsAhead.delete(key);
  }
  /** Drops everything kept of the project, with its reads ahead still on their way. */
  forget(projectId: string) {
    const ofProject = (key: string) => key.startsWith(`${projectId}\n`);
    for (const key of this.answers.keys()) if (ofProject(key)) this.answers.delete(key);
    for (const key of this.unopened) if (ofProject(key)) this.unopened.delete(key);
    for (const key of this.readsAhead.keys()) if (ofProject(key)) this.readsAhead.delete(key);
  }
}
