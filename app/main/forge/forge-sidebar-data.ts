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
  type DetailItem,
  type DetailResult,
  type ForgeListItems,
  type ForgeListTab,
  type ForgeListView,
  type ForgeLists,
  type ForgeSidebarEvent,
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

/** A shown project's lists, with what the sidebar shows of them and the request that may settle them. */
interface ShownList {
  view: ForgeListView;
  lists: ForgeLists;
  request: object | null;
}

/** The item a project's detail shows, with the request that may settle it. */
interface HeldDetail {
  item: DetailItem;
  request: object;
}

const noRows = { loaded: null, failed: null };

/** The Forge sidebar's data (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md): each shown project's lists,
 * the item its detail shows, and the repositories its binding pages offer. The renderer declares what it shows and
 * reports the direct actions and dispatches that changed an item; this module asks the forge and pushes the result.
 * Only the latest request of a project settles its lists, and its detail. Nothing is kept once the sidebar hides, and
 * nothing refreshes on a timer. */
export class ForgeSidebarData {
  private lists = new Map<string, ShownList>();
  private details = new Map<string, HeldDetail>();
  private choices = new Map<string, { request: object; choices: ShownRepositoryChoices }>();
  constructor(private sources: ForgeSidebarSources) {}

  /** Shows the project's lists on `view`: its tab and filter. Loads that tab's first page; resolves once it settled. */
  showList(projectId: string, view: ForgeListView) {
    const declared = forgeListViewSchema.parse(view);
    const shown = this.lists.get(projectId) ?? {
      view: declared,
      lists: { issues: noRows, pullRequests: noRows, loading: false },
      request: null,
    };
    shown.view = declared;
    this.lists.set(projectId, shown);
    return this.load(projectId, shown, declared.tab, declared.filter, null);
  }
  /** The sidebar no longer shows the project's lists: they are dropped with its detail, and any answer still on its
   * way. */
  hideList(projectId: string) {
    this.lists.delete(projectId);
    this.details.delete(projectId);
  }
  /** Appends the next page of the rows shown, in the filter that produced them. */
  async loadMore(projectId: string) {
    const shown = this.lists.get(projectId);
    const loaded = shown?.lists[shown.view.tab].loaded;
    if (!shown || !loaded?.cursor) return;
    return this.load(projectId, shown, shown.view.tab, loaded.filter, loaded.cursor);
  }
  /** Loads the shown tab's first page and the open detail again; the detail keeps showing until its new answer. */
  async refresh(projectId: string) {
    const shown = this.lists.get(projectId);
    const detail = this.details.get(projectId);
    await Promise.all([
      shown && this.load(projectId, shown, shown.view.tab, shown.view.filter, null),
      detail && this.loadDetail(projectId, detail.item),
    ]);
  }
  /** Shows `item` in the project's detail, loading it anew on each call and pushing the answer; null closes the
   * detail. */
  async showDetail(projectId: string, item: DetailItem | null) {
    if (item === null) {
      this.details.delete(projectId);
      return;
    }
    return this.loadDetail(projectId, detailItemSchema.parse(item));
  }
  /** A direct action or dispatch changed `item`: reloads what shows it, the shown tab's first page and the open detail,
   * and shows what the forge then holds. */
  async reloadChanged(projectId: string, item: DetailItem) {
    detailItemSchema.parse(item);
    return this.refresh(projectId);
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
  /** Drops what the module holds of the project: it was deleted, or its binding changed. */
  forget(projectId: string) {
    this.lists.delete(projectId);
    this.details.delete(projectId);
    this.choices.delete(projectId);
  }

  private async load<T extends ForgeListTab>(
    projectId: string,
    shown: ShownList,
    tab: T,
    filter: ListFilter,
    cursor: string | null,
  ) {
    const request = {};
    shown.request = request;
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
    const previous = shown.lists[tab] as TabList<ForgeListItems[T]>;
    let next: TabList<ForgeListItems[T]>;
    if (!page.ok) next = { ...previous, failed: page };
    else {
      const { ok: _, ...rows } = page;
      next = {
        failed: null,
        loaded:
          cursor !== null && previous.loaded
            ? { ...rows, filter, items: [...previous.loaded.items, ...rows.items] }
            : { ...rows, filter },
      };
    }
    this.settle(projectId, shown, { ...shown.lists, [tab]: next, loading: false });
  }
  /** Asks the forge for the detail's item; its answer is pushed unless another request was made since. */
  private async loadDetail(projectId: string, item: DetailItem) {
    const request = {};
    this.details.set(projectId, { item, request });
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
    if (this.details.get(projectId)?.request !== request) return;
    this.sources.emit({ kind: 'forgeDetail', projectId, detail: { item, result } });
  }
  private settle(projectId: string, shown: ShownList, lists: ForgeLists) {
    shown.lists = lists;
    this.sources.emit({ kind: 'forgeLists', projectId, lists });
  }
}
