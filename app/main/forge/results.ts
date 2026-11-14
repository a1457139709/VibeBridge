/** A repository's issues and pull requests read from its forge and changed by direct actions: the data, or the forge failure.
 * What the renderer asks for is checked here before the forge sees it. */
import { directActionSchema, itemNumberSchema, listQuerySchema } from '../../shared/forge';
import type { DirectAction, DirectActionResult, ForgeFailure, IssueDetailResult, IssuePage, ListQuery, PullRequestDetailResult, PullRequestPage, RepositoryReference } from '../../shared/forge';
import { forges } from './forges';
import { ForgeError, type Forge } from './forge';

/** Runs `call` on the repository's forge; a ForgeError becomes that forge's failure, with what `onFailure` adds. */
async function fromForge<T, F extends object>(repository: RepositoryReference, call: (forge: Forge) => Promise<T>,
  onFailure: (forge: Forge, error: ForgeError) => Promise<F>): Promise<({ ok: true } & T) | ({ ok: false; failure: ForgeFailure } & F)> {
  const forge = forges[repository.forge];
  try { return { ok: true, ...await call(forge) }; }
  catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    return { ok: false, failure: error.failure(forge), ...await onFailure(forge, error) };
  }
}

/** An inaccessible repository is reported with the active account, so the user can tell which account lacks access. */
const listFailure = async (forge: Forge, error: ForgeError) =>
  ({ account: error.kind === 'inaccessible' ? await forge.account().catch(() => null) : null });

/** One page of the repository's issues from its forge, or the forge failure. */
export function issuePage(repository: RepositoryReference, query: ListQuery): Promise<IssuePage> {
  return fromForge(repository, forge => forge.issues(repository.path, listQuerySchema.parse(query)), listFailure);
}

/** One page of the repository's pull requests from its forge, or the forge failure. */
export function pullRequestPage(repository: RepositoryReference, query: ListQuery): Promise<PullRequestPage> {
  return fromForge(repository, forge => forge.pullRequests(repository.path, listQuerySchema.parse(query)), listFailure);
}

/** One issue of the repository from its forge, with its rendered body, comments and relations; or the forge failure. */
export function issueDetail(repository: RepositoryReference, number: number): Promise<IssueDetailResult> {
  return fromForge(repository, async forge => ({ issue: await forge.issue(repository.path, itemNumberSchema.parse(number)) }), async () => ({}));
}

/** One pull request of the repository from its forge, with its rendered body and what stands between it and a merge; or the forge failure. */
export function pullRequestDetail(repository: RepositoryReference, number: number): Promise<PullRequestDetailResult> {
  return fromForge(repository, async forge => ({ pullRequest: await forge.pullRequest(repository.path, itemNumberSchema.parse(number)) }), async () => ({}));
}

/** Carries out a direct action on the repository's forge: what the forge said, or the forge failure with its text. */
export function directAction(repository: RepositoryReference, action: DirectAction): Promise<DirectActionResult> {
  return fromForge(repository, async forge => ({ detail: await forge.act(repository.path, directActionSchema.parse(action)) }), async () => ({}));
}
