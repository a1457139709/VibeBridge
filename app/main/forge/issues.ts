import type { ForgeFailure, IssueDetailResult, IssueListQuery, IssuePage, RepositoryReference } from '../../shared/forge';
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

/** One page of the repository's issues from its forge, or the forge failure. An inaccessible repository is
 * reported with the active account, so the user can tell which account lacks access. */
export function issuePage(repository: RepositoryReference, query: IssueListQuery): Promise<IssuePage> {
  return fromForge(repository, forge => forge.issues(repository.path, query),
    async (forge, error) => ({ account: error.kind === 'inaccessible' ? await forge.account().catch(() => null) : null }));
}

/** One issue of the repository from its forge, with its rendered body, comments and relations; or the forge failure. */
export function issueDetail(repository: RepositoryReference, number: number): Promise<IssueDetailResult> {
  return fromForge(repository, async forge => ({ issue: await forge.issue(repository.path, number) }), async () => ({}));
}
