import type { IssueListQuery, IssuePage, RepositoryReference } from '../../shared/forge';
import { forges } from './forges';
import { ForgeError } from './forge';

/** One page of the repository's issues from its forge, or the forge failure. An inaccessible repository is
 * reported with the active account, so the user can tell which account lacks access. */
export async function issuePage(repository: RepositoryReference, query: IssueListQuery): Promise<IssuePage> {
  const forge = forges[repository.forge];
  try { return { ok: true, ...await forge.issues(repository.path, query) }; }
  catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    const account = error.kind === 'inaccessible' ? await forge.account().catch(() => null) : null;
    return { ok: false, failure: error.failure(forge), account };
  }
}
