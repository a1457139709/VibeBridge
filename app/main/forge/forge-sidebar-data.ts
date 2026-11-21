import { z } from 'zod';
import { itemNumberSchema, itemsPerRead, type ListFilter, type Page } from '../../shared/forge/forge';
import {
  detailItemSchema,
  forgeListViewSchema,
  forgeSidebarPresenceSchema,
  sameItem,
  type DetailItem,
  type FailedPage,
  type ForgeListItems,
  type ForgeListTab,
  type ForgeListView,
  type ForgeLists,
  type ForgeSidebarPresence,
  type ShownDetail,
  type ShownRepositoryChoices,
  type TabList,
} from '../../shared/forge/sidebar-data';
import { KeptDetails } from './kept-details';
import {
  emptyLists,
  joinedPages,
  pagesThroughRows,
  replacedInPlace,
  sameFilter,
  type Joining,
  type KeptLists,
} from './kept-lists';
import { RowRest } from './row-rest';
import { BackgroundUpdates } from './background-updates';
import { readByNumber, readItem, readPage, readRepositoryChoices, type ForgeSidebarSources } from './sidebar-reads';

/** The projects whose lists are kept, the most recently shown. */
const projectsKept = 5;

/** The item a project's detail shows, with its read still on its way, which settles it while the detail stays open on
 * this entry. */
interface OpenDetail {
  item: DetailItem;
  reading: Promise<void> | null;
}

const tabOf = (item: DetailItem): ForgeListTab => (item.kind === 'issue' ? 'issues' : 'pullRequests');

/** The Forge sidebar's data (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md): each project's lists, the
 * item its detail shows, and the repositories its binding pages offer. The renderer declares what it shows, reports
 * whether the sidebar shows a project in the foreground, and reports the direct actions and dispatches that changed an
 * item; this module asks the forge and pushes the result.
 *
 * It keeps, in memory only, the lists of the 5 projects shown last (each tab with the rows of its latest filter) and the
 * 50 details used last. A declaration shows what is kept at once. When the sidebar comes to show a project in the
 * foreground, and every 5 minutes while it shows it there, the data updates in the background, in place: the shown
 * tab's first page, the rows the sidebar renders read by number, and the open detail, asked at once. Nothing updates
 * while the sidebar is hidden or its window is behind. An update reported while one runs joins it, an update joins a
 * request of the lists on its way, and an update or a refresh joins a read of the open detail on its way. Only the
 * latest request of a project settles its lists, and its detail. A list row the pointer or focus rests on 150ms while
 * the sidebar shows its project in the foreground has its detail read ahead into the kept details, unless kept
 * already, so opening it shows at once. */
export class ForgeSidebarData {
  private lists = new Map<string, KeptLists>();
  private openDetails = new Map<string, OpenDetail>();
  private details = new KeptDetails();
  private choices = new Map<string, { request: object; choices: ShownRepositoryChoices }>();
  /** Each project's binding, counted up when it changes: an answer for an earlier one is not kept. */
  private bindings = new Map<string, number>();
  private presence: ForgeSidebarPresence | null = null;
  private updates = new BackgroundUpdates(projectId => this.updateShownData(projectId));
  /** The row the pointer or focus rests on, until its detail is read ahead. */
  private rowRest = new RowRest();
  constructor(private sources: ForgeSidebarSources) {}

  /** Takes whether the sidebar shows the project's lists and whether its window is in the foreground. When the sidebar
   * comes to show a project in the foreground (shown, returned to, or the window back in front), its shown tab's first
   * page, rendered rows and open detail update in the background, and again every 5 minutes while it shows there;
   * resolves once they settled. A hidden project's detail closes. */
  async reportPresence(presence: ForgeSidebarPresence) {
    const reported = forgeSidebarPresenceSchema.parse(presence);
    if (!reported.visible) this.openDetails.delete(reported.projectId);
    // A project hidden after another came to show leaves the sidebar on that one.
    if (!reported.visible && this.presence && this.presence.projectId !== reported.projectId) return;
    const before = this.watched();
    this.presence = reported;
    const watched = this.watched();
    if (watched !== before) await this.updates.watch(watched);
  }
  /** Shows the project's lists on `view`: its tab and filter. Rows kept for that tab and filter show at once; the same
   * view as last declared asks nothing more, another updates them in the background, and without rows the first page
   * loads. Resolves once the lists settled. */
  showList(projectId: string, view: ForgeListView) {
    const declared = forgeListViewSchema.parse(view);
    const keptLists = this.useLists(projectId);
    if (keptLists && keptLists.view.tab === declared.tab && sameFilter(keptLists.view.filter, declared.filter)) {
      this.settle(projectId, keptLists, keptLists.lists);
      return keptLists.settled;
    }
    const shown = keptLists ?? this.add(projectId, declared);
    shown.view = declared;
    const loaded = shown.lists[declared.tab].loaded;
    const kept = !!loaded && sameFilter(loaded.filter, declared.filter);
    return this.load(projectId, shown, declared.tab, declared.filter, kept ? 'update' : 'replace');
  }
  /** Declares the numbers of the shown tab's rows the sidebar renders: a refresh reloads through the page holding
   * them, and a background update reads them by number. */
  async showRows(projectId: string, numbers: number[]) {
    const shown = this.lists.get(projectId);
    if (shown) shown.rows = z.array(itemNumberSchema).parse(numbers);
  }
  /** Appends the next page of the rows shown, in the filter that produced them. */
  async loadMore(projectId: string) {
    const shown = this.useLists(projectId);
    const loaded = shown?.lists[shown.view.tab].loaded;
    if (!shown || !loaded?.nextCursor) return;
    return this.load(projectId, shown, shown.view.tab, loaded.filter, 'append');
  }
  /** Reloads the shown tab from its first page through the page holding the last row the sidebar renders, in place of
   * its rows, and the open detail again, unless a read of it is on its way; the rows and the detail keep showing until
   * their new answers. */
  async refresh(projectId: string) {
    const shown = this.useLists(projectId);
    await Promise.all([
      shown && this.load(projectId, shown, shown.view.tab, shown.view.filter, 'replace', pagesThroughRows(shown)),
      this.rereadOpenDetail(projectId),
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
    if (kept)
      this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item: declared, result: kept, failed: null } });
    if (kept && this.details.openUnopened(projectId, declared)) {
      this.openDetails.set(projectId, { item: declared, reading: null });
      return;
    }
    await this.loadDetail(projectId, declared);
  }
  /** A direct action or dispatch changed `item`: reads it again alone, its list row by number and its detail when open,
   * at once, and shows what the forge then holds; the row stays where it is. A detail kept for it while closed is
   * dropped. */
  async reloadChanged(projectId: string, item: DetailItem) {
    const changed = detailItemSchema.parse(item);
    const open = this.openDetails.get(projectId);
    const opened = !!open && sameItem(open.item, changed);
    if (!opened) this.details.drop(projectId, changed);
    const shown = this.lists.get(projectId);
    const tab = tabOf(changed);
    await Promise.all([
      opened && this.loadDetail(projectId, changed),
      shown &&
        this.loadByNumber(projectId, shown, tab, [changed.number]).then(
          failed => failed && this.keepFailure(projectId, shown, tab, failed),
        ),
    ]);
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
    const choices = await readRepositoryChoices(this.sources, projectId);
    if (this.choices.get(projectId)?.request !== request) return;
    this.choices.set(projectId, { request, choices });
    this.sources.emit({ kind: 'repositoryChoices', projectId, choices });
  }
  /** Drops everything the module holds of the project, its kept lists and details too: it was deleted, or its binding
   * changed. */
  forget(projectId: string) {
    this.bindings.set(projectId, (this.bindings.get(projectId) ?? 0) + 1);
    this.lists.delete(projectId);
    this.updates.forget(projectId);
    this.openDetails.delete(projectId);
    this.choices.delete(projectId);
    this.details.forget(projectId);
  }

  /** The project the sidebar shows in the foreground, or null. */
  private watched() {
    const presence = this.presence;
    return presence?.visible && presence.foreground ? presence.projectId : null;
  }
  /** Updates the project's data in the background: the shown tab, unless a request of its lists is running, and the
   * open detail, unless a read of it is on its way; asked at once. */
  private async updateShownData(projectId: string) {
    const shown = this.useLists(projectId);
    await Promise.all([
      shown && (shown.request ? shown.settled : this.updateShownTab(projectId, shown)),
      this.rereadOpenDetail(projectId),
    ]);
  }
  /** Reads the open detail's item again, or joins its read on its way; nothing when no detail is open. */
  private rereadOpenDetail(projectId: string) {
    const open = this.openDetails.get(projectId);
    return open && (open.reading ?? this.loadDetail(projectId, open.item));
  }
  /** Updates the shown tab's first page in place and reads the rows the sidebar renders by number, asked at once. A
   * failed read of the rows stands beside them once the first page settled, which would clear it. */
  private async updateShownTab(projectId: string, shown: KeptLists) {
    const { tab, filter } = shown.view;
    const [, failed] = await Promise.all([
      this.load(projectId, shown, tab, filter, 'update'),
      this.loadByNumber(projectId, shown, tab, shown.rows),
    ]);
    if (failed) this.keepFailure(projectId, shown, tab, failed);
  }
  /** Reads again the rows of the tab with these numbers, those it holds, and replaces them in place; resolves with the
   * failure of the read, if any. An answer for rows no longer shown, in another filter or binding, is dropped. */
  private async loadByNumber(projectId: string, shown: KeptLists, tab: ForgeListTab, numbers: number[]) {
    const before = shown.lists[tab].loaded;
    const held = new Set(before?.items.map(row => row.number));
    const asked = numbers.filter(number => held.has(number)).slice(0, itemsPerRead);
    if (!before || !asked.length) return null;
    const binding = this.bindings.get(projectId);
    const read = await readByNumber(this.sources, projectId, tab, asked);
    const loaded = shown.lists[tab].loaded;
    if (this.lists.get(projectId) !== shown || this.bindings.get(projectId) !== binding) return null;
    if (!loaded || !sameFilter(loaded.filter, before.filter)) return null;
    if (!read.ok) return read;
    const items = replacedInPlace<ForgeListItems[ForgeListTab]>(loaded.items, read.items);
    this.settle(projectId, shown, { ...shown.lists, [tab]: { ...shown.lists[tab], loaded: { ...loaded, items } } });
    return null;
  }
  /** Shows a failed read beside the tab's rows, unless the lists were dropped or the tab shows a failure already. */
  private keepFailure(projectId: string, shown: KeptLists, tab: ForgeListTab, failed: FailedPage) {
    if (this.lists.get(projectId) !== shown || shown.lists[tab].failed) return;
    this.settle(projectId, shown, { ...shown.lists, [tab]: { ...shown.lists[tab], failed } });
  }
  /** The project's kept lists, now the most recently used; undefined when none are kept. */
  private useLists(projectId: string) {
    const shown = this.lists.get(projectId);
    if (shown) {
      this.lists.delete(projectId);
      this.lists.set(projectId, shown);
    }
    return shown;
  }
  /** Keeps empty lists for the project on `view`, dropping the lists, open detail and running update of the project
   * shown longest ago beyond the limit. */
  private add(projectId: string, view: ForgeListView) {
    const shown = emptyLists(view);
    this.lists.set(projectId, shown);
    for (const oldest of this.lists.keys()) {
      if (this.lists.size <= projectsKept) break;
      this.lists.delete(oldest);
      this.openDetails.delete(oldest);
      this.updates.forget(oldest);
    }
    return shown;
  }
  /** Loads `pages` pages of `tab` in `filter`, joined to its rows as `joining` says, and settles the lists once they
   * are all in. */
  private load<T extends ForgeListTab>(
    projectId: string,
    shown: KeptLists,
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
    shown: KeptLists,
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
    for (let cursor = joining === 'append' ? before.loaded!.nextCursor : null; pages > 0; pages--) {
      page = await readPage(this.sources, projectId, tab, { filter, cursor });
      if (shown.request !== request || this.lists.get(projectId) !== shown) return;
      if (!page.ok) break;
      items.push(...page.items);
      pageEnds.push(items.length);
      if (!(cursor = page.nextCursor)) break;
    }
    shown.request = null;
    const previous = shown.lists[tab] as TabList<ForgeListItems[T]>;
    const joined = joinedPages(previous, shown.pageEnds[tab], filter, joining, page!, items, pageEnds);
    shown.pageEnds[tab] = joined.pageEnds;
    this.settle(projectId, shown, { ...shown.lists, [tab]: joined.rows, loading: false });
  }
  /** Reads the item's detail ahead of its opening, into the kept details. */
  private async readAhead(projectId: string, item: DetailItem) {
    if (this.watched() !== projectId || this.details.holds(projectId, item)) return;
    const open = this.openDetails.get(projectId);
    if (open && sameItem(open.item, item)) return;
    await this.details.readAhead(projectId, item, readItem(this.sources, projectId, item));
  }
  /** Opens the detail on `item` and asks the forge for it; resolves once the answer settled. */
  private loadDetail(projectId: string, item: DetailItem) {
    const open: OpenDetail = { item, reading: null };
    this.openDetails.set(projectId, open);
    open.reading = this.readOpenDetail(projectId, open).finally(() => (open.reading = null));
    return open.reading;
  }
  /** Asks the forge for the open detail's item, or takes its read ahead on its way, and keeps an answer that is not a
   * failure. The answer is pushed unless the detail was opened again since; a failure leaves the item's kept answer
   * showing beside it, and shows alone when none is kept. */
  private async readOpenDetail(projectId: string, open: OpenDetail) {
    const { item } = open;
    const binding = this.bindings.get(projectId);
    const result = await (this.details.takeReadAhead(projectId, item) ?? readItem(this.sources, projectId, item));
    // An answer for an earlier binding is not kept.
    if (result.ok && this.bindings.get(projectId) === binding) this.details.keep(projectId, item, result);
    if (this.openDetails.get(projectId) !== open) return;
    const kept = result.ok ? undefined : this.details.use(projectId, item);
    const detail: ShownDetail =
      kept && !result.ok ? { item, result: kept, failed: result.failure } : { item, result, failed: null };
    this.sources.emit({ kind: 'forgeDetail', projectId, detail });
  }

  private settle(projectId: string, shown: KeptLists, lists: ForgeLists) {
    shown.lists = lists;
    this.sources.emit({ kind: 'forgeLists', projectId, lists });
  }
}
