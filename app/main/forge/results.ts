/** A repository's issues and pull requests read from its forge and changed by direct actions: the data, or the forge failure.
 * What the renderer asks for is checked here before the forge sees it. */
import { directActionSchema, itemNumberSchema, listQuerySchema } from '../../shared/forge/forge';
import type {
  DirectAction,
  DirectActionResult,
  ForgeFailure,
  IssueDetailResult,
  IssuePage,
  ListQuery,
  PullRequestDetailResult,
  PullRequestPage,
  RepositoryReference,
} from '../../shared/forge/forge';
import { forges } from './forges';
import { ForgeError, type Answered, type Forge } from './forge';

/** A bound repository a call is made on, and `follow`, which moves the binding to where the forge found the repository
 * when that is another path. */
export interface Bound {
  repository: RepositoryReference;
  follow(found: RepositoryReference): void;
}

/** Runs `call` on the bound repository's forge; a ForgeError becomes that forge's failure, with what `onFailure` adds. */
async function fromForge<T, F extends object>(
  bound: Bound,
  call: (forge: Forge) => Promise<T>,
  onFailure: (forge: Forge, error: ForgeError, repository: RepositoryReference) => Promise<F>,
): Promise<({ ok: true } & T) | ({ ok: false; failure: ForgeFailure } & F)> {
  const forge = forges[bound.repository.forge];
  try {
    return { ok: true, ...(await call(forge)) };
  } catch (error) {
    if (!(error instanceof ForgeError)) throw error;
    return { ok: false, failure: error.failure(forge), ...(await onFailure(forge, error, bound.repository)) };
  }
}

/** Reads the bound repository at its bound path, checking by ID in the same request that the repository answering there
 * is the bound one (docs/adr/0006-forges-sit-behind-an-interface.md). At another path (renamed or transferred, its former path
 * redirecting) the binding follows it there. With no repository or another one at the path, the forge locates it by ID
 * and the binding follows it. Either way the read is asked again at the new path: an answer from the former path, a
 * search above all, is not trusted. */
async function readChecked<T>(
  forge: Forge,
  bound: Bound,
  read: (repository: RepositoryReference) => Promise<Answered<T>>,
): Promise<T> {
  const { repository } = bound;
  let notFound: ForgeError | null = null;
  const answered = await read(repository).catch((error: unknown) => {
    if (!(error instanceof ForgeError) || error.kind !== 'inaccessible') throw error;
    notFound = error;
    return null;
  });
  const same = answered?.answeredBy.id === repository.id;
  if (same && answered.answeredBy.path === repository.path) return answered.data;
  const moved = { ...repository, path: same ? answered.answeredBy.path : await forge.locate(repository) };
  // Located at its bound path, the repository is there and the read failed on something else: that failure stands.
  if (moved.path === repository.path) throw notFound ?? new ForgeError('inaccessible', '');
  bound.follow(moved);
  const again = await read(moved);
  if (again.answeredBy.id !== repository.id) throw new ForgeError('inaccessible', '');
  return again.data;
}

/** An inaccessible repository is reported with the active account, so the user can tell which account lacks access. */
const listFailure = async (forge: Forge, error: ForgeError, repository: RepositoryReference) => ({
  account: error.kind === 'inaccessible' ? await forge.account(repository.host).catch(() => null) : null,
});
const nothingMore = async () => ({});

/** One page of the repository's issues from its forge, or the forge failure. */
export async function issuePage(bound: Bound, query: ListQuery): Promise<IssuePage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(
    bound,
    forge => readChecked(forge, bound, repository => forge.issues(repository, asked)),
    listFailure,
  );
}

/** One page of the repository's pull requests from its forge, or the forge failure. */
export async function pullRequestPage(bound: Bound, query: ListQuery): Promise<PullRequestPage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(
    bound,
    forge => readChecked(forge, bound, repository => forge.pullRequests(repository, asked)),
    listFailure,
  );
}

/** One issue of the repository from its forge, with its rendered body, comments and relations; or the forge failure. */
export async function issueDetail(bound: Bound, number: number): Promise<IssueDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(
    bound,
    async forge => ({ issue: await readChecked(forge, bound, repository => forge.issue(repository, asked)) }),
    nothingMore,
  );
}

/** One pull request of the repository from its forge, with its rendered body and what stands between it and a merge; or the forge failure. */
export async function pullRequestDetail(bound: Bound, number: number): Promise<PullRequestDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(
    bound,
    async forge => ({
      pullRequest: await readChecked(forge, bound, repository => forge.pullRequest(repository, asked)),
    }),
    nothingMore,
  );
}

/** Carries out a direct action on the repository's forge at its bound path, located by no request first: a direct action
 * starts from data a read just checked. What the forge said, or the forge failure with its text. */
export async function directAction(bound: Bound, action: DirectAction): Promise<DirectActionResult> {
  const asked = directActionSchema.parse(action);
  return fromForge(bound, async forge => ({ detail: await forge.act(bound.repository, asked) }), nothingMore);
}
