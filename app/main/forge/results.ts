/** A repository's issues and pull requests read from its forge and changed by direct actions: the data, or the forge failure.
 * What the renderer asks for is checked here before the forge sees it. */
import { directActionSchema, itemNumberSchema, listQuerySchema } from '../../shared/forge';
import type { DirectAction, DirectActionResult, ForgeFailure, IssueDetailResult, IssuePage, ListQuery, PullRequestDetailResult, PullRequestPage, RepositoryReference } from '../../shared/forge';
import { forges } from './forges';
import { ForgeError, type Forge } from './forge';

/** A bound repository a call is made on, and where to report the path the forge found it at when it has moved. */
export interface Bound { repository: RepositoryReference; moved(repository: RepositoryReference): void }

/** Locates the bound repository on its forge, then runs `call` on it at its current path; a ForgeError becomes that
 * forge's failure, with what `onFailure` adds. */
async function fromForge<T, F extends object>(bound: Bound, call: (forge: Forge, repository: RepositoryReference) => Promise<T>,
  onFailure: (forge: Forge, error: ForgeError, repository: RepositoryReference) => Promise<F>): Promise<({ ok: true } & T) | ({ ok: false; failure: ForgeFailure } & F)> {
  const forge = forges[bound.repository.forge];
  try {
    const path = await forge.locate(bound.repository);
    const repository = path === bound.repository.path ? bound.repository : { ...bound.repository, path };
    if (repository !== bound.repository) bound.moved(repository);
    return { ok: true, ...await call(forge, repository) };
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    return { ok: false, failure: error.failure(forge), ...await onFailure(forge, error, bound.repository) };
  }
}

/** An inaccessible repository is reported with the active account, so the user can tell which account lacks access. */
const listFailure = async (forge: Forge, error: ForgeError, repository: RepositoryReference) =>
  ({ account: error.kind === 'inaccessible' ? await forge.account(repository.host).catch(() => null) : null });
const nothingMore = async () => ({});

/** One page of the repository's issues from its forge, or the forge failure. */
export async function issuePage(bound: Bound, query: ListQuery): Promise<IssuePage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(bound, (forge, repository) => forge.issues(repository, asked), listFailure);
}

/** One page of the repository's pull requests from its forge, or the forge failure. */
export async function pullRequestPage(bound: Bound, query: ListQuery): Promise<PullRequestPage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(bound, (forge, repository) => forge.pullRequests(repository, asked), listFailure);
}

/** One issue of the repository from its forge, with its rendered body, comments and relations; or the forge failure. */
export async function issueDetail(bound: Bound, number: number): Promise<IssueDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(bound, async (forge, repository) => ({ issue: await forge.issue(repository, asked) }), nothingMore);
}

/** One pull request of the repository from its forge, with its rendered body and what stands between it and a merge; or the forge failure. */
export async function pullRequestDetail(bound: Bound, number: number): Promise<PullRequestDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(bound, async (forge, repository) => ({ pullRequest: await forge.pullRequest(repository, asked) }), nothingMore);
}

/** Carries out a direct action on the repository's forge: what the forge said, or the forge failure with its text. */
export async function directAction(bound: Bound, action: DirectAction): Promise<DirectActionResult> {
  const asked = directActionSchema.parse(action);
  return fromForge(bound, async (forge, repository) => ({ detail: await forge.act(repository, asked) }), nothingMore);
}
