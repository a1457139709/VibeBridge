import { message } from '../../shared/messages';
import { issueFilterSchema, type IssueDetailResult, type IssueFilter, type IssuePageResult, type RepositoryReference } from '../../shared/code-hosting';
import { PlatformError, type CommandEnvironment } from './platform';
import { platforms } from './platforms';

/** One page of the bound repository's issues, or the kind of failure the platform reported. */
export async function issuePage(repository: RepositoryReference, filter: IssueFilter, cursor: string | null, environment: CommandEnvironment): Promise<IssuePageResult> {
  const parsed = issueFilterSchema.safeParse(filter);
  if (!parsed.success || (cursor !== null && typeof cursor !== 'string')) throw new Error(message('issueFilterInvalid'));
  const platform = platforms[repository.platform];
  try {
    return { ok: true, page: await platform.issues(environment, repository.path, parsed.data, cursor) };
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
export async function issueDetail(repository: RepositoryReference, number: number, environment: CommandEnvironment): Promise<IssueDetailResult> {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(message('issueNumberInvalid'));
  try {
    return { ok: true, issue: await platforms[repository.platform].issue(environment, repository.path, number) };
  } catch (error) {
    if (error instanceof PlatformError) return { ok: false, failure: error.failure };
    throw error;
  }
}
