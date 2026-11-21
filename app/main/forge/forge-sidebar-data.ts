import { z } from 'zod';
import { itemNumberSchema, type ListFilter, type Page } from '../../shared/forge/forge';
import {
  detailItemSchema,
  forgeListViewSchema,
  forgeSidebarPresenceSchema,
  type DetailItem,
  type DetailResult,
  type ForgeListItems,
  type ForgeListTab,
  type ForgeListView,
  type ForgeLists,
  type ForgeSidebarPresence,
  type ShownRepositoryChoices,
  type TabList,
} from '../../shared/forge/sidebar-data';
import { KeptDetails } from './kept-details';
import { RowRest } from './row-rest';
import { readItem, readPage, type ForgeSidebarSources } from './sidebar-reads';

/** The projects whose lists are kept, the most recently shown. */
const projectsKept = 5;

/** A project's lists, with the view the sidebar last declared, where each page a tab loaded ends in its rows (the count
 * of rows through it), the numbers of the shown tab's rows the sidebar renders, and the request that may settle them
 * while it runs. */
interface CachedList {
  view: ForgeListView;
  lists: ForgeLists;
  pageEnds: Record<ForgeListTab, number[]>;
  rows: number[];
  request: object | null;
  settled: Promise<void>;
}

/** The item a project's detail shows, with the request that may settle it. */
interface OpenDetail {
  item: DetailItem;
  request: object;
}

/** How a first page or the next one joins a tab's rows: `replace` shows the first page alone, `update` replaces the rows
 * it holds in place and keeps the others, and `append` adds the next page. */
type Joining = 'replace' | 'update' | 'append';

const noRows = { loaded: null, failed: null };
const sameFilter = (a: ListFilter, b: ListFilter) =>
  a.search === b.search && a.state === b.state && a.labels.join('\n') === b.labels.join('\n');
const sameItem = (a: DetailItem, b: DetailItem) => a.kind === b.kind && a.number === b.number;
const tabOf = (item: DetailItem): ForgeListTab => (item.kind === 'issue' ? 'issues' : 'pullRequests');

/** `rows` with each one `fresh` also holds replaced in place, and each new one placed after the row before it in
 * `fresh`, or first. Rows `fresh` does not hold stay where they were. */
export function updatedInPlace<Item extends { number: number }>(rows: Item[], fresh: Item[]) {
  const answered = new Map(fresh.map(item => [item.number, item]));
  const updated = rows.map(row => answered.get(row.number) ?? row);
  const held = new Set(rows.map(row => row.number));
  let at = 0;
  for (const item of fresh) {
    if (held.has(item.number)) at = updated.findIndex(row => row.number === item.number) + 1;
    else updated.splice(at++, 0, item);
  }
  return updated;
}

/** A list row with what its item's detail now holds of it: title, state and labels. */
function rowWithDetail<Item extends ForgeListItems[ForgeListTab]>(row: Item, result: DetailResult): Item {
  if (!result.ok) return row;
  if ('issue' in result) {
    const { title, state, closedAs, labels } = result.issue;
    return { ...row, title, state, closedAs, labels };
  }
  const { title, state, labels } = result.pullRequest;
  return { ...row, title, state, labels };
}

/** The Forge sidebar's data (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md): each project's lists, the
 * item its detail shows, and the repositories its binding pages offer. The renderer declares what it shows, reports
 * whether the sidebar shows a project in the foreground, and reports the direct actions and dispatches that changed an
 * item; this module asks the forge and pushes the result.
 *
 * It keeps, in memory only, the lists of the 5 projects shown last (each tab with the rows of its latest filter) and the
 * 50 details used last. A declaration shows what is kept at once. When the sidebar comes to show a project in the
 * foreground, the shown tab's first page and the open detail update in the background, in place; nothing updates while
 * the sidebar is hidden. Only the latest request of a project settles its lists, and its detail. A list row the
 * pointer or focus rests on 150ms while the sidebar shows its project in the foreground has its detail read ahead into
 * the kept details, unless kept already, so opening it shows at once. */
export class ForgeSidebarData {
  private lists = new Map<string, CachedList>();
  private openDetails = new Map<string, OpenDetail>();
  private details = new KeptDetails();
  private choices = new Map<string, { request: object; choices: ShownRepositoryChoices }>();
  /** Each project's binding, counted up when it changes: an answer for an earlier one is not kept. */
  private bindings = new Map<string, number>();
  private presence: ForgeSidebarPresence | null = null;
  /** The row the pointer or focus rests on, until its detail is read ahead. */
  private rowRest = new RowRest();
  constructor(private sources: ForgeSidebarSources) {}

  /** Takes whether the sidebar shows the project's lists and whether its window is in the foreground. When the sidebar
   * comes to show a project in the foreground (shown, returned to, or the window back in front), its shown tab's first
   * page and open detail update in the background; resolves once they settled. A hidden project's detail closes. */
  async reportPresence(presence: ForgeSidebarPresence) {
    const reported = forgeSidebarPresenceSchema.parse(presence);
    if (!reported.visible) this.openDetails.delete(reported.projectId);
    // A project hidden after another came to show leaves the sidebar on that one.
    if (!reported.visible && this.presence && this.presence.projectId !== reported.projectId) return;
    const before = this.watched();
    this.presence = reported;
    const watched = this.watched();
    if (watched !== null && watched !== before) await this.update(watched);
  }
  /** Shows the project's lists on `view`: its tab and filter. Rows kept for that tab and filter show at once; the same
   * view as last declared asks nothing more, another updates them in the background, and without rows the first page
   * loads. Resolves once the lists settled. */
  showList(projectId: string, view: ForgeListView) {
    const declared = forgeListViewSchema.parse(view);
    const cached = this.keep(projectId);
    if (cached && cached.view.tab === declared.tab && sameFilter(cached.view.filter, declared.filter)) {
      this.settle(projectId, cached, cached.lists);
      return cached.settled;
    }
    const shown = cached ?? this.add(projectId, declared);
    shown.view = declared;
    const loaded = shown.lists[declared.tab].loaded;
    const kept = !!loaded && sameFilter(loaded.filter, declared.filter);
    return this.load(projectId, shown, declared.tab, declared.filter, kept ? 'update' : 'replace');
  }
  /** Declares the numbers of the shown tab's rows the sidebar renders: a refresh reloads through the page holding
   * them. */
  async showRows(projectId: string, numbers: number[]) {
    const shown = this.lists.get(projectId);
    if (shown) shown.rows = z.array(itemNumberSchema).parse(numbers);
  }
  /** Appends the next page of the rows shown, in the filter that produced them. */
  async loadMore(projectId: string) {
    const shown = this.keep(projectId);
    const loaded = shown?.lists[shown.view.tab].loaded;
    if (!shown || !loaded?.cursor) return;
    return this.load(projectId, shown, shown.view.tab, loaded.filter, 'append');
  }
  /** Reloads the shown tab from its first page through the page holding the last row the sidebar renders, in place of
   * its rows, and the open detail again; the rows and the detail keep showing until their new answers. */
  async refresh(projectId: string) {
    const shown = this.keep(projectId);
    const detail = this.openDetails.get(projectId);
    await Promise.all([
      shown && this.load(projectId, shown, shown.view.tab, shown.view.filter, 'replace', pagesThroughRows(shown)),
      detail && this.loadDetail(projectId, detail.item),
    ]);
  }
  /** Shows `item` in the project's detail: a kept answer at once, then the forge's answer, asked on each call. A
   * detail read ahead and not opened since asks nothing more, and one still being read ahead waits for that answer.
   * Null closes the detail. */
  async showDetail(projectId: string, item: DetailItem | null) {
    if (item === null) {
      this.openDetails.delete(projectId);
      return;
    }
    const declared = detailItemSchema.parse(item);
    const kept = this.details.use(projectId, declared);
    if (kept) this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item: declared, result: kept } });
    if (kept && this.details.openUnopened(projectId, declared)) {
      this.openDetails.set(projectId, { item: declared, request: {} });
      return;
    }
    await this.loadDetail(projectId, declared);
  }
  /** A direct action or dispatch changed `item`: reloads its detail alone, and shows what the forge then holds in the
   * open detail and in the item's list row, which stays where it is. */
  async reloadChanged(projectId: string, item: DetailItem) {
    const changed = detailItemSchema.parse(item);
    const binding = this.bindings.get(projectId);
    const open = this.openDetails.get(projectId);
    const result =
      open && sameItem(open.item, changed)
        ? await this.loadDetail(projectId, changed)
        : await this.readDetail(projectId, changed);
    const shown = this.lists.get(projectId);
    const tab = tabOf(changed);
    const loaded = shown?.lists[tab].loaded;
    if (!result.ok || !shown || !loaded || this.bindings.get(projectId) !== binding) return;
    if (!loaded.items.some(row => row.number === changed.number)) return;
    const items = loaded.items.map(row => (row.number === changed.number ? rowWithDetail(row, result) : row));
    this.settle(projectId, shown, { ...shown.lists, [tab]: { ...shown.lists[tab], loaded: { ...loaded, items } } });
  }
  /** Takes the list row the pointer or keyboard focus rests on, or null when it left the rows. Once it rested 150ms,
   * the row's detail is read ahead into the kept details. Resolves once that read settled, or the rest ended without
   * one. */
  reportRestingOn(projectId: string, item: DetailItem | null) {
    const rested = item && detailItemSchema.parse(item);
    return this.rowRest.restOn(rested && (() => this.readAhead(projectId, rested)));
  }
  /** Reads the repositories the project can bind, once per call: a binding page shows them, and Retry reads again. */
  async showRepositoryChoices(projectId: string) {
    const request = {};
    this.choices.set(projectId, { request, choices: null });
    this.sources.emit({ kind: 'repositoryChoices', projectId, choices: null });
    let choices: ShownRepositoryChoices;
    try {
      choices = await this.sources.repositoryChoices(projectId);
    } catch (error) {
      choices = { ok: false, error: (error as Error).message };
    }
    if (this.choices.get(projectId)?.request !== request) return;
    this.choices.set(projectId, { request, choices });
    this.sources.emit({ kind: 'repositoryChoices', projectId, choices });
  }
  /** Drops everything the module holds of the project, its kept lists and details too: it was deleted, or its binding
   * changed. */
  forget(projectId: string) {
    this.bindings.set(projectId, (this.bindings.get(projectId) ?? 0) + 1);
    this.lists.delete(projectId);
    this.openDetails.delete(projectId);
    this.choices.delete(projectId);
    this.details.forget(projectId);
  }

  /** The project the sidebar shows in the foreground, or null. */
  private watched() {
    const presence = this.presence;
    return presence?.visible && presence.foreground ? presence.projectId : null;
  }
  /** Updates the shown tab's first page in place, unless a request is running, and the open detail. */
  private async update(projectId: string) {
    const shown = this.keep(projectId);
    const detail = this.openDetails.get(projectId);
    await Promise.all([
      shown &&
        (shown.request ? shown.settled : this.load(projectId, shown, shown.view.tab, shown.view.filter, 'update')),
      detail && this.loadDetail(projectId, detail.item),
    ]);
  }
  /** The project's kept lists, now the most recently used; undefined when none are kept. */
  private keep(projectId: string) {
    const shown = this.lists.get(projectId);
    if (shown) {
      this.lists.delete(projectId);
      this.lists.set(projectId, shown);
    }
    return shown;
  }
  /** Keeps empty lists for the project on `view`, dropping the lists of the project shown longest ago beyond the limit. */
  private add(projectId: string, view: ForgeListView) {
    const shown: CachedList = {
      view,
      lists: { issues: noRows, pullRequests: noRows, loading: false },
      pageEnds: { issues: [], pullRequests: [] },
      rows: [],
      request: null,
      settled: Promise.resolve(),
    };
    this.lists.set(projectId, shown);
    for (const oldest of this.lists.keys()) {
      if (this.lists.size <= projectsKept) break;
      this.lists.delete(oldest);
      this.openDetails.delete(oldest);
    }
    return shown;
  }
  /** Loads `pages` pages of `tab` in `filter`, joined to its rows as `joining` says, and settles the lists once they
   * are all in. */
  private load<T extends ForgeListTab>(
    projectId: string,
    shown: CachedList,
    tab: T,
    filter: ListFilter,
    joining: Joining,
    pages = 1,
  ) {
    const request = {};
    shown.request = request;
    shown.settled = this.loadPages(projectId, shown, request, tab, filter, joining, pages);
    return shown.settled;
  }
  private async loadPages<T extends ForgeListTab>(
    projectId: string,
    shown: CachedList,
    request: object,
    tab: T,
    filter: ListFilter,
    joining: Joining,
    pages: number,
  ) {
    const before = shown.lists[tab] as TabList<ForgeListItems[T]>;
    this.settle(projectId, shown, { ...shown.lists, loading: true });
    const items: ForgeListItems[T][] = [];
    const pageEnds: number[] = [];
    let page: Page<ForgeListItems[T]> | undefined;
    // The pages follow one another: each asks from where the one before ended.
    for (let cursor = joining === 'append' ? before.loaded!.cursor : null; pages > 0; pages--) {
      page = await readPage(this.sources, projectId, tab, { filter, cursor });
      if (shown.request !== request || this.lists.get(projectId) !== shown) return;
      if (!page.ok) break;
      items.push(...page.items);
      pageEnds.push(items.length);
      if (!(cursor = page.cursor)) break;
    }
    shown.request = null;
    const previous = shown.lists[tab] as TabList<ForgeListItems[T]>;
    let next: TabList<ForgeListItems[T]>;
    if (!page!.ok) next = { ...previous, failed: page! };
    else {
      const { ok: _, ...rows } = page!;
      const held = previous.loaded && sameFilter(previous.loaded.filter, filter) ? previous.loaded : null;
      if (joining === 'append' && held) {
        const numbers = new Set(held.items.map(item => item.number));
        const joined = [...held.items, ...items.filter(item => !numbers.has(item.number))];
        next = { failed: null, loaded: { ...rows, filter, items: joined } };
        shown.pageEnds[tab] = [...shown.pageEnds[tab], joined.length];
      } else if (joining === 'update' && held) {
        const updated = updatedInPlace(held.items, items);
        const cursor = shown.pageEnds[tab].length > 1 ? held.cursor : rows.cursor;
        next = { failed: null, loaded: { ...rows, filter, items: updated, cursor } };
      } else {
        next = { failed: null, loaded: { ...rows, filter, items } };
        shown.pageEnds[tab] = pageEnds;
      }
    }
    this.settle(projectId, shown, { ...shown.lists, [tab]: next, loading: false });
  }
  /** Asks the forge for the item and keeps an answer that is not a failure, dropping the detail used longest ago beyond
   * the limit; an answer for an earlier binding is not kept. */
  private async readDetail(projectId: string, item: DetailItem) {
    const binding = this.bindings.get(projectId);
    const result = await readItem(this.sources, projectId, item);
    if (result.ok && this.bindings.get(projectId) === binding) this.details.keep(projectId, item, result);
    return result;
  }
  /** Reads the item's detail ahead of its opening, into the kept details. */
  private async readAhead(projectId: string, item: DetailItem) {
    if (this.watched() !== projectId || this.details.holds(projectId, item)) return;
    const open = this.openDetails.get(projectId);
    if (open && sameItem(open.item, item)) return;
    await this.details.readAhead(projectId, item, this.readDetail(projectId, item));
  }
  /** Asks the forge for the detail's item; its answer is pushed unless another request was made since. */
  private async loadDetail(projectId: string, item: DetailItem) {
    const request = {};
    this.openDetails.set(projectId, { item, request });
    const result = await (this.details.takeReadAhead(projectId, item) ?? this.readDetail(projectId, item));
    if (this.openDetails.get(projectId)?.request === request)
      this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item, result } });
    return result;
  }
  private settle(projectId: string, shown: CachedList, lists: ForgeLists) {
    shown.lists = lists;
    this.sources.emit({ kind: 'forgeLists', projectId, lists });
  }
}

/** How many pages of the shown tab, from the first, hold every row the sidebar renders; at least one. */
function pagesThroughRows(shown: CachedList) {
  const { tab } = shown.view;
  const items: { number: number }[] = shown.lists[tab].loaded?.items ?? [];
  const rendered = new Set(shown.rows);
  const last = items.findLastIndex(item => rendered.has(item.number));
  return Math.max(shown.pageEnds[tab].findIndex(end => end > last) + 1, 1);
}
