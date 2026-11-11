import { message } from '../../shared/messages';
import { issueFilterSchema, type IssueDetailResult, type IssueFilter, type IssuePageResult, type ListFailure, type MergeRequestDetailResult, type MergeRequestPageResult, type RepositoryReference } from '../../shared/code-hosting';
import { PlatformError, type CodeHostingPlatform, type CommandEnvironment } from './platform';
import { platforms } from './platforms';

/** The project's Repository Binding; an unbound project reads nothing. */
function boundRepository(repository: RepositoryReference | undefined): RepositoryReference {
  if (!repository) throw new Error(message('repositoryUnbound'));
  return repository;
}

/** One page of the bound repository's issues, or the kind of failure the platform reported. */
export function issuePage(repository: RepositoryReference | undefined, filter: IssueFilter, cursor: string | null, environment: CommandEnvironment): Promise<IssuePageResult> {
  const bound = boundRepository(repository);
  return listPage(bound, filter, cursor, environment, (platform, filter) => platform.issues(environment, bound.path, filter, cursor));
}

/** One page of the bound repository's merge requests, or the kind of failure the platform reported. */
export function mergeRequestPage(repository: RepositoryReference | undefined, filter: IssueFilter, cursor: string | null, environment: CommandEnvironment): Promise<MergeRequestPageResult> {
  const bound = boundRepository(repository);
  return listPage(bound, filter, cursor, environment, (platform, filter) => platform.mergeRequests(environment, bound.path, filter, cursor));
}

async function listPage<Page>(repository: RepositoryReference, filter: IssueFilter, cursor: string | null, environment: CommandEnvironment,
  read: (platform: CodeHostingPlatform, filter: IssueFilter) => Promise<Page>): Promise<{ ok: true; page: Page } | ListFailure> {
  const parsed = issueFilterSchema.safeParse(filter);
  if (!parsed.success || (cursor !== null && typeof cursor !== 'string')) throw new Error(message('issueFilterInvalid'));
  const platform = platforms[repository.platform];
  try {
    return { ok: true, page: await read(platform, parsed.data) };
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    const { failure } = error;
    if (failure.kind !== 'unreachable') return { ok: false, failure };
    // Missing and forbidden look alike, so the account tells the user whose access to check.
    const account = await platform.account(environment).catch(() => undefined);
    return account === undefined ? { ok: false, failure } : { ok: false, failure, account };
  }
}

/** The bound repository's issue with that number, or the kind of failure the platform reported. */
export async function issueDetail(repository: RepositoryReference | undefined, number: number, environment: CommandEnvironment): Promise<IssueDetailResult> {
  const read = await detail(repository, number, (platform, path) => platform.issue(environment, path, number));
  return read.ok ? { ok: true, issue: read.value } : read;
}

/** The bound repository's merge request with that number, or the kind of failure the platform reported. */
export async function mergeRequestDetail(repository: RepositoryReference | undefined, number: number, environment: CommandEnvironment): Promise<MergeRequestDetailResult> {
  const read = await detail(repository, number, (platform, path) => platform.mergeRequest(environment, path, number));
  return read.ok ? { ok: true, mergeRequest: read.value } : read;
}

async function detail<T>(repository: RepositoryReference | undefined, number: number, read: (platform: CodeHostingPlatform, path: string) => Promise<T>) {
  const { platform, path } = boundRepository(repository);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(message('issueNumberInvalid'));
  try {
    return { ok: true as const, value: await read(platforms[platform], path) };
  } catch (error) {
    if (error instanceof PlatformError) return { ok: false as const, failure: error.failure };
    throw error;
  }
}
