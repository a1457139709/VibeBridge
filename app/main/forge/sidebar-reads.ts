import type {
  ForgeFailure,
  ForgePresentation,
  IssueDetailResult,
  IssuePage,
  IssuesByNumber,
  ItemsByNumber,
  ListQuery,
  Page,
  PullRequestDetailResult,
  PullRequestPage,
  PullRequestsByNumber,
  RepositoryChoices,
} from '../../shared/forge/forge';
import type {
  DetailItem,
  DetailResult,
  ForgeListItems,
  ForgeListTab,
  ForgeSidebarEvent,
} from '../../shared/forge/sidebar-data';

/** Where the Forge sidebar's data comes from, and where it goes. Each read is of a project's bound repository, or of the
 * repositories the project can bind. */
export interface ForgeSidebarSources {
  issuePage(projectId: string, query: ListQuery): Promise<IssuePage>;
  pullRequestPage(projectId: string, query: ListQuery): Promise<PullRequestPage>;
  issuesByNumber(projectId: string, numbers: number[]): Promise<IssuesByNumber>;
  pullRequestsByNumber(projectId: string, numbers: number[]): Promise<PullRequestsByNumber>;
  repositoryChoices(projectId: string): Promise<RepositoryChoices>;
  issueDetail(projectId: string, number: number): Promise<IssueDetailResult>;
  pullRequestDetail(projectId: string, number: number): Promise<PullRequestDetailResult>;
  /** How the project's forge presents itself, for a failure outside the forge. */
  forge(projectId: string): ForgePresentation;
  emit(event: ForgeSidebarEvent): void;
}

// Each read of the Forge sidebar's data reports a failure outside the forge (the request itself) like a transient one,
// with its reason.

const outsideForge = (sources: ForgeSidebarSources, projectId: string, error: unknown): ForgeFailure => ({
  kind: 'transient',
  detail: (error as Error).message,
  forge: sources.forge(projectId),
});

/** Asks the forge for a page of `tab`. */
export async function readPage<T extends ForgeListTab>(
  sources: ForgeSidebarSources,
  projectId: string,
  tab: T,
  query: ListQuery,
): Promise<Page<ForgeListItems[T]>> {
  try {
    return (await (tab === 'issues' ? sources.issuePage : sources.pullRequestPage)(projectId, query)) as Page<
      ForgeListItems[T]
    >;
  } catch (error) {
    return { ok: false, failure: outsideForge(sources, projectId, error), account: null };
  }
}

/** Asks the forge for the items of `tab` with these numbers, with no search. */
export async function readByNumber(
  sources: ForgeSidebarSources,
  projectId: string,
  tab: ForgeListTab,
  numbers: number[],
): Promise<ItemsByNumber<ForgeListItems[ForgeListTab]>> {
  try {
    return await (tab === 'issues' ? sources.issuesByNumber : sources.pullRequestsByNumber)(projectId, numbers);
  } catch (error) {
    return { ok: false, failure: outsideForge(sources, projectId, error), account: null };
  }
}

/** Asks the forge for the item's detail. */
export async function readItem(
  sources: ForgeSidebarSources,
  projectId: string,
  item: DetailItem,
): Promise<DetailResult> {
  try {
    return await (item.kind === 'issue' ? sources.issueDetail : sources.pullRequestDetail)(projectId, item.number);
  } catch (error) {
    return { ok: false, failure: outsideForge(sources, projectId, error) };
  }
}
