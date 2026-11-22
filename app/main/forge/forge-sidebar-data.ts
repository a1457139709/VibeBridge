import { z } from 'zod';
import { itemNumberSchema, itemsPerRead, type ListFilter } from '../../shared/forge/forge';
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

const projectsKept = 5;

interface OpenDetail {
  item: DetailItem;
  reading: Promise<void> | null;
}

const tabOf = (item: DetailItem): ForgeListTab => (item.kind === 'issue' ? 'issues' : 'pullRequests');
function tabList<T extends ForgeListTab>(lists: ForgeLists, tab: T): TabList<ForgeListItems[T]> {
  const tabs: { [K in ForgeListTab]: TabList<ForgeListItems[K]> } = lists;
  return tabs[tab];
}

export class ForgeSidebarData {
  private lists = new Map<string, KeptLists>();
  private openDetails = new Map<string, OpenDetail>();
  private details = new KeptDetails();
  private choices = new Map<string, { request: object; choices: ShownRepositoryChoices }>();
  private bindings = new Map<string, number>();
  private presence: ForgeSidebarPresence | null = null;
  private updates = new BackgroundUpdates(projectId => this.updateShownData(projectId));
  private rowRest = new RowRest();
  constructor(private sources: ForgeSidebarSources) {}

  async reportPresence(presence: ForgeSidebarPresence) {
    const reported = forgeSidebarPresenceSchema.parse(presence);
    if (!reported.visible) this.openDetails.delete(reported.projectId);
    if (!reported.visible && this.presence && this.presence.projectId !== reported.projectId) return;
    const before = this.watched();
    this.presence = reported;
    const watched = this.watched();
    if (watched !== before) await this.updates.watch(watched);
  }
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
  async showRows(projectId: string, numbers: number[]) {
    const shown = this.lists.get(projectId);
    if (shown) shown.rows = z.array(itemNumberSchema).parse(numbers);
  }
  async loadMore(projectId: string) {
    const shown = this.useLists(projectId);
    const loaded = shown?.lists[shown.view.tab].loaded;
    if (!shown || !loaded?.nextCursor) return;
    return this.load(projectId, shown, shown.view.tab, loaded.filter, 'append');
  }
  async refresh(projectId: string) {
    const shown = this.useLists(projectId);
    await Promise.all([
      shown && this.load(projectId, shown, shown.view.tab, shown.view.filter, 'replace', pagesThroughRows(shown)),
      this.rereadOpenDetail(projectId),
    ]);
  }
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
  reportRestingOn(projectId: string, item: DetailItem | null) {
    const rested = item && detailItemSchema.parse(item);
    return this.rowRest.restOn(rested && (() => this.readAhead(projectId, rested)));
  }
  async showRepositoryChoices(projectId: string) {
    const request = {};
    this.choices.set(projectId, { request, choices: null });
    this.sources.emit({ kind: 'repositoryChoices', projectId, choices: null });
    const choices = await readRepositoryChoices(this.sources, projectId);
    if (this.choices.get(projectId)?.request !== request) return;
    this.choices.set(projectId, { request, choices });
    this.sources.emit({ kind: 'repositoryChoices', projectId, choices });
  }
  forget(projectId: string) {
    this.bindings.set(projectId, (this.bindings.get(projectId) ?? 0) + 1);
    this.lists.delete(projectId);
    this.updates.forget(projectId);
    this.openDetails.delete(projectId);
    this.choices.delete(projectId);
    this.details.forget(projectId);
  }

  private watched() {
    const presence = this.presence;
    return presence?.visible && presence.foreground ? presence.projectId : null;
  }
  private async updateShownData(projectId: string) {
    const shown = this.useLists(projectId);
    await Promise.all([
      shown && (shown.request ? shown.settled : this.updateShownTab(projectId, shown)),
      this.rereadOpenDetail(projectId),
    ]);
  }
  private rereadOpenDetail(projectId: string) {
    const open = this.openDetails.get(projectId);
    return open && (open.reading ?? this.loadDetail(projectId, open.item));
  }
  private async updateShownTab(projectId: string, shown: KeptLists) {
    const { tab, filter } = shown.view;
    const [, failed] = await Promise.all([
      this.load(projectId, shown, tab, filter, 'update'),
      this.loadByNumber(projectId, shown, tab, shown.rows),
    ]);
    if (failed) this.keepFailure(projectId, shown, tab, failed);
  }
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
  private keepFailure(projectId: string, shown: KeptLists, tab: ForgeListTab, failed: FailedPage) {
    if (this.lists.get(projectId) !== shown || shown.lists[tab].failed) return;
    this.settle(projectId, shown, { ...shown.lists, [tab]: { ...shown.lists[tab], failed } });
  }
  private useLists(projectId: string) {
    const shown = this.lists.get(projectId);
    if (shown) {
      this.lists.delete(projectId);
      this.lists.set(projectId, shown);
    }
    return shown;
  }
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
    const before = tabList(shown.lists, tab);
    this.settle(projectId, shown, { ...shown.lists, loading: true });
    const items: ForgeListItems[T][] = [];
    const pageEnds: number[] = [];
    let cursor = joining === 'append' ? (before.loaded?.nextCursor ?? null) : null;
    let page = await readPage(this.sources, projectId, tab, { filter, cursor });
    for (;;) {
      if (shown.request !== request || this.lists.get(projectId) !== shown) return;
      if (!page.ok) break;
      items.push(...page.items);
      pageEnds.push(items.length);
      if (!(cursor = page.nextCursor) || --pages < 1) break;
      page = await readPage(this.sources, projectId, tab, { filter, cursor });
    }
    shown.request = null;
    const joined = joinedPages(tabList(shown.lists, tab), shown.pageEnds[tab], filter, joining, page, items, pageEnds);
    shown.pageEnds[tab] = joined.pageEnds;
    this.settle(projectId, shown, { ...shown.lists, [tab]: joined.rows, loading: false });
  }
  private async readAhead(projectId: string, item: DetailItem) {
    if (this.watched() !== projectId || this.details.holds(projectId, item)) return;
    const open = this.openDetails.get(projectId);
    if (open && sameItem(open.item, item)) return;
    await this.details.readAhead(projectId, item, readItem(this.sources, projectId, item));
  }
  private loadDetail(projectId: string, item: DetailItem) {
    const open: OpenDetail = { item, reading: null };
    this.openDetails.set(projectId, open);
    open.reading = this.readOpenDetail(projectId, open).finally(() => (open.reading = null));
    return open.reading;
  }
  private async readOpenDetail(projectId: string, open: OpenDetail) {
    const { item } = open;
    const binding = this.bindings.get(projectId);
    const result = await (this.details.takeReadAhead(projectId, item) ?? readItem(this.sources, projectId, item));
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
