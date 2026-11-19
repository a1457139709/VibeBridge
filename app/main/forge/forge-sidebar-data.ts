import type {
  ForgePresentation,
  IssueDetailResult,
  IssuePage,
  ListFilter,
  ListQuery,
  Page,
  PullRequestDetailResult,
  PullRequestPage,
  RepositoryChoices,
} from '../../shared/forge/forge';
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
  type ForgeSidebarEvent,
  type ForgeSidebarPresence,
  type ShownRepositoryChoices,
  type TabList,
} from '../../shared/forge/sidebar-data';

/** Where the Forge sidebar's data comes from, and where it goes. Each read is of a project's bound repository, or of the
 * repositories the project can bind. */
export interface ForgeSidebarSources {
  issuePage(projectId: string, query: ListQuery): Promise<IssuePage>;
  pullRequestPage(projectId: string, query: ListQuery): Promise<PullRequestPage>;
  repositoryChoices(projectId: string): Promise<RepositoryChoices>;
  issueDetail(projectId: string, number: number): Promise<IssueDetailResult>;
  pullRequestDetail(projectId: string, number: number): Promise<PullRequestDetailResult>;
  /** How the project's forge presents itself, for a failure outside the forge. */
  forge(projectId: string): ForgePresentation;
  emit(event: ForgeSidebarEvent): void;
}

/** The projects whose lists are kept, the most recently shown. */
const projectsKept = 5;
/** The details kept across all projects, the most recently used. */
const detailsKept = 50;

/** A project's lists, with the view the sidebar last declared, how many pages each tab loaded, and the request that may
 * settle them while it runs. */
interface CachedList {
  view: ForgeListView;
  lists: ForgeLists;
  pages: Record<ForgeListTab, number>;
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
 * the sidebar is hidden. Only the latest request of a project settles its lists, and its detail. */
export class ForgeSidebarData {
  private lists = new Map<string, CachedList>();
  private openDetails = new Map<string, OpenDetail>();
  private details = new Map<string, DetailResult>();
  private choices = new Map<string, { request: object; choices: ShownRepositoryChoices }>();
  /** Each project's binding, counted up when it changes: an answer for an earlier one is not kept. */
  private bindings = new Map<string, number>();
  private presence: ForgeSidebarPresence | null = null;
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
  /** Appends the next page of the rows shown, in the filter that produced them. */
  async loadMore(projectId: string) {
    const shown = this.keep(projectId);
    const loaded = shown?.lists[shown.view.tab].loaded;
    if (!shown || !loaded?.cursor) return;
    return this.load(projectId, shown, shown.view.tab, loaded.filter, 'append');
  }
  /** Loads the shown tab's first page in place of its rows, and the open detail again; the detail keeps showing until
   * its new answer. */
  async refresh(projectId: string) {
    const shown = this.keep(projectId);
    const detail = this.openDetails.get(projectId);
    await Promise.all([
      shown && this.load(projectId, shown, shown.view.tab, shown.view.filter, 'replace'),
      detail && this.loadDetail(projectId, detail.item),
    ]);
  }
  /** Shows `item` in the project's detail: a kept answer at once, then the forge's answer, asked on each call. Null
   * closes the detail. */
  async showDetail(projectId: string, item: DetailItem | null) {
    if (item === null) {
      this.openDetails.delete(projectId);
      return;
    }
    const declared = detailItemSchema.parse(item);
    const kept = this.keptDetail(projectId, declared);
    if (kept) this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item: declared, result: kept } });
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
    for (const key of this.details.keys()) if (key.startsWith(`${projectId}\n`)) this.details.delete(key);
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
      pages: { issues: 0, pullRequests: 0 },
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
  private load<T extends ForgeListTab>(
    projectId: string,
    shown: CachedList,
    tab: T,
    filter: ListFilter,
    joining: Joining,
  ) {
    const request = {};
    shown.request = request;
    shown.settled = this.loadPage(projectId, shown, request, tab, filter, joining);
    return shown.settled;
  }
  private async loadPage<T extends ForgeListTab>(
    projectId: string,
    shown: CachedList,
    request: object,
    tab: T,
    filter: ListFilter,
    joining: Joining,
  ) {
    const before = shown.lists[tab] as TabList<ForgeListItems[T]>;
    const cursor = joining === 'append' ? before.loaded!.cursor : null;
    this.settle(projectId, shown, { ...shown.lists, loading: true });
    let page: Page<ForgeListItems[T]>;
    // A failure outside the forge (the request itself) is reported like a transient one, with its reason.
    try {
      page = (await (tab === 'issues' ? this.sources.issuePage : this.sources.pullRequestPage)(projectId, {
        filter,
        cursor,
      })) as Page<ForgeListItems[T]>;
    } catch (error) {
      page = {
        ok: false,
        failure: { kind: 'transient', detail: (error as Error).message, forge: this.sources.forge(projectId) },
        account: null,
      };
    }
    if (shown.request !== request || this.lists.get(projectId) !== shown) return;
    shown.request = null;
    const previous = shown.lists[tab] as TabList<ForgeListItems[T]>;
    let next: TabList<ForgeListItems[T]>;
    if (!page.ok) next = { ...previous, failed: page };
    else {
      const { ok: _, ...rows } = page;
      const held = previous.loaded && sameFilter(previous.loaded.filter, filter) ? previous.loaded : null;
      if (joining === 'append' && held) {
        const numbers = new Set(held.items.map(item => item.number));
        const items = [...held.items, ...rows.items.filter(item => !numbers.has(item.number))];
        next = { failed: null, loaded: { ...rows, filter, items } };
        shown.pages[tab]++;
      } else if (joining === 'update' && held) {
        const items = updatedInPlace(held.items, rows.items);
        const cursor = shown.pages[tab] > 1 ? held.cursor : rows.cursor;
        next = { failed: null, loaded: { ...rows, filter, items, cursor } };
      } else {
        next = { failed: null, loaded: { ...rows, filter } };
        shown.pages[tab] = 1;
      }
    }
    this.settle(projectId, shown, { ...shown.lists, [tab]: next, loading: false });
  }
  private detailKey(projectId: string, { kind, number }: DetailItem) {
    return `${projectId}\n${kind}\n${number}`;
  }
  /** The kept answer for the item, now the most recently used; undefined when none is kept. */
  private keptDetail(projectId: string, item: DetailItem) {
    const key = this.detailKey(projectId, item);
    const kept = this.details.get(key);
    if (kept) {
      this.details.delete(key);
      this.details.set(key, kept);
    }
    return kept;
  }
  /** Asks the forge for the item and keeps an answer that is not a failure, dropping the detail used longest ago beyond
   * the limit; an answer for an earlier binding is not kept. */
  private async readDetail(projectId: string, item: DetailItem) {
    const binding = this.bindings.get(projectId);
    let result: DetailResult;
    // A failure outside the forge (the request itself) is reported like a transient one, with its reason.
    try {
      result = await (item.kind === 'issue' ? this.sources.issueDetail : this.sources.pullRequestDetail)(
        projectId,
        item.number,
      );
    } catch (error) {
      result = {
        ok: false,
        failure: { kind: 'transient', detail: (error as Error).message, forge: this.sources.forge(projectId) },
      };
    }
    if (result.ok && this.bindings.get(projectId) === binding) {
      const key = this.detailKey(projectId, item);
      this.details.delete(key);
      this.details.set(key, result);
      for (const oldest of this.details.keys()) {
        if (this.details.size <= detailsKept) break;
        this.details.delete(oldest);
      }
    }
    return result;
  }
  /** Asks the forge for the detail's item; its answer is pushed unless another request was made since. */
  private async loadDetail(projectId: string, item: DetailItem) {
    const request = {};
    this.openDetails.set(projectId, { item, request });
    const result = await this.readDetail(projectId, item);
    if (this.openDetails.get(projectId)?.request === request)
      this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item, result } });
    return result;
  }
  private settle(projectId: string, shown: CachedList, lists: ForgeLists) {
    shown.lists = lists;
    this.sources.emit({ kind: 'forgeLists', projectId, lists });
  }
}
