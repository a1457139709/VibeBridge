import { directActionSchema, itemNumberSchema, itemNumbersSchema, listQuerySchema } from '../../shared/forge/forge';
import type {
  DirectAction,
  DirectActionResult,
  ForgeFailure,
  IssueDetailResult,
  IssuePage,
  IssuesByNumber,
  ListQuery,
  PullRequestDetailResult,
  PullRequestPage,
  PullRequestsByNumber,
  RepositoryReference,
} from '../../shared/forge/forge';
import { message } from '../../shared/messages';
import { forges } from './forges';
import { ForgeError, type Answered, type Forge } from './forge';

export interface BoundRepository {
  repository: RepositoryReference;
  follow(found: RepositoryReference): void;
}

async function fromForge<T, F extends object>(
  bound: BoundRepository,
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

const otherRepositoryAt = (path: string) => new ForgeError('inaccessible', message('otherRepositoryAnswers', { path }));

async function readChecked<T>(
  forge: Forge,
  bound: BoundRepository,
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
  if (moved.path === repository.path) throw notFound ?? otherRepositoryAt(repository.path);
  bound.follow(moved);
  const again = await read(moved);
  if (again.answeredBy.id !== repository.id) throw otherRepositoryAt(moved.path);
  return again.data;
}

const accountWhenInaccessible = async (forge: Forge, error: ForgeError, repository: RepositoryReference) => ({
  account: error.kind === 'inaccessible' ? await forge.account(repository.host).catch(() => null) : null,
});
const nothingMore = async () => ({});

export async function issuePage(bound: BoundRepository, query: ListQuery): Promise<IssuePage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(
    bound,
    forge => readChecked(forge, bound, repository => forge.issues(repository, asked)),
    accountWhenInaccessible,
  );
}

export async function pullRequestPage(bound: BoundRepository, query: ListQuery): Promise<PullRequestPage> {
  const asked = listQuerySchema.parse(query);
  return fromForge(
    bound,
    forge => readChecked(forge, bound, repository => forge.pullRequests(repository, asked)),
    accountWhenInaccessible,
  );
}

function itemsByNumber<Item>(
  bound: BoundRepository,
  numbers: number[],
  read: (forge: Forge, repository: RepositoryReference, numbers: number[]) => Promise<Answered<Item[]>>,
) {
  const asked = itemNumbersSchema.parse(numbers);
  return fromForge(
    bound,
    async forge => ({ items: await readChecked(forge, bound, repository => read(forge, repository, asked)) }),
    accountWhenInaccessible,
  );
}

export function issuesByNumber(bound: BoundRepository, numbers: number[]): Promise<IssuesByNumber> {
  return itemsByNumber(bound, numbers, (forge, repository, asked) => forge.issuesByNumber(repository, asked));
}

export function pullRequestsByNumber(bound: BoundRepository, numbers: number[]): Promise<PullRequestsByNumber> {
  return itemsByNumber(bound, numbers, (forge, repository, asked) => forge.pullRequestsByNumber(repository, asked));
}

export async function issueDetail(bound: BoundRepository, number: number): Promise<IssueDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(
    bound,
    async forge => ({ issue: await readChecked(forge, bound, repository => forge.issue(repository, asked)) }),
    nothingMore,
  );
}

export async function pullRequestDetail(bound: BoundRepository, number: number): Promise<PullRequestDetailResult> {
  const asked = itemNumberSchema.parse(number);
  return fromForge(
    bound,
    async forge => ({
      pullRequest: await readChecked(forge, bound, repository => forge.pullRequest(repository, asked)),
    }),
    nothingMore,
  );
}

export async function directAction(bound: BoundRepository, action: DirectAction): Promise<DirectActionResult> {
  const asked = directActionSchema.parse(action);
  return fromForge(bound, async forge => ({ detail: await forge.act(bound.repository, asked) }), nothingMore);
}
