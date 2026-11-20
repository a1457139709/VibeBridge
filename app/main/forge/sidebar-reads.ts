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

/** Asks `read` of the sources; a failure outside the forge (the request itself) is reported like a transient one, with
 * its reason, as `failed` shapes it. */
async function fromSources<T>(
  sources: ForgeSidebarSources,
  projectId: string,
  read: () => Promise<T>,
  failed: (failure: ForgeFailure) => T,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    return failed({ kind: 'transient', detail: (error as Error).message, forge: sources.forge(projectId) });
  }
}

/** Asks the forge for a page of `tab`. */
export function readPage<T extends ForgeListTab>(
  sources: ForgeSidebarSources,
  projectId: string,
  tab: T,
  query: ListQuery,
): Promise<Page<ForgeListItems[T]>> {
  const read = tab === 'issues' ? sources.issuePage : sources.pullRequestPage;
  return fromSources(
    sources,
    projectId,
    () => read(projectId, query) as Promise<Page<ForgeListItems[T]>>,
    failure => ({ ok: false, failure, account: null }),
  );
}

/** Asks the forge for the items of `tab` with these numbers, with no search. */
export function readByNumber(
  sources: ForgeSidebarSources,
  projectId: string,
  tab: ForgeListTab,
  numbers: number[],
): Promise<ItemsByNumber<ForgeListItems[ForgeListTab]>> {
  const read = tab === 'issues' ? sources.issuesByNumber : sources.pullRequestsByNumber;
  return fromSources<ItemsByNumber<ForgeListItems[ForgeListTab]>>(
    sources,
    projectId,
    () => read(projectId, numbers),
    failure => ({ ok: false, failure, account: null }),
  );
}

/** Asks the forge for the item's detail. */
export function readItem(sources: ForgeSidebarSources, projectId: string, item: DetailItem): Promise<DetailResult> {
  const read = item.kind === 'issue' ? sources.issueDetail : sources.pullRequestDetail;
  return fromSources<DetailResult>(
    sources,
    projectId,
    () => read(projectId, item.number),
    failure => ({ ok: false, failure }),
  );
}

/** Asks the forge for the repositories the project can bind. */
export function readRepositoryChoices(sources: ForgeSidebarSources, projectId: string): Promise<RepositoryChoices> {
  return fromSources<RepositoryChoices>(
    sources,
    projectId,
    () => sources.repositoryChoices(projectId),
    failure => ({ ok: false, failure }),
  );
}
