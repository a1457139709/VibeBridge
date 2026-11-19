import type {
  DirectAction,
  ForgeCapabilities,
  ForgeFailure,
  ForgeFailureKind,
  ForgeId,
  ForgePresentation,
  IssueDetail,
  ListPage,
  ListQuery,
  ListedIssue,
  PullRequestDetail,
  PullRequestSummary,
  RepositoryReference,
} from '../../shared/forge/forge';

/** A failure of a forge call, in one of the forge-neutral kinds, with the forge's own text. */
export class ForgeError extends Error {
  constructor(
    readonly kind: ForgeFailureKind,
    readonly detail: string,
  ) {
    super(detail || kind);
  }
  /** The failure as the UI receives it, with how `forge` presents itself. */
  failure(forge: Forge): ForgeFailure {
    return { kind: this.kind, detail: this.detail, forge: forge.presentation };
  }
}

/** A repository as the forge lists it: its ID, which a rename or transfer keeps, and its current path. */
export interface ListedRepository {
  id: string;
  path: string;
}

/** What a read found at the path it was given: the repository that answered there, by its ID and current path, and the
 * data. A renamed or transferred repository may answer at its former path; another repository may have taken it. */
export interface Answered<T> {
  answeredBy: ListedRepository;
  data: T;
}

/** One Forge behind the Workbench. The adapter is the only code that talks to the forge or its
 * CLI. It declares the features it has in `capabilities`. It returns domain shapes with forge-neutral names and throws ForgeError on every forge failure.
 * Its identity is the forge CLI's active account on each host (docs/adr/0004-identity-comes-from-the-forge-cli.md).
 * A read on a repository names the repository that answered at its path, so the caller can tell whether it is the one
 * asked for; a write trusts the path it is given. */
export interface Forge {
  id: ForgeId;
  /** The host an unbound project lists repositories from. */
  defaultHost: string;
  presentation: ForgePresentation;
  capabilities: ForgeCapabilities;
  /** The active account's name on the host. */
  account(host: string): Promise<string>;
  /** Every repository the active account on the host can bind. */
  repositories(host: string): Promise<ListedRepository[]>;
  /** The repository path on the host this `origin` URL points at, or null when it points elsewhere. */
  remotePath(host: string, originUrl: string): string | null;
  /** The entry of `paths` that names the same path as `path`, in its listed spelling, or null. */
  find(path: string, paths: string[]): string | null;
  /** The repository's current path, found by its ID wherever a rename or transfer moved it, for when a read at its path
   * found no repository or another one. Throws `inaccessible` when the repository is gone or the account cannot see it,
   * also when another repository has taken its path. */
  locate(repository: RepositoryReference): Promise<string>;
  /** The page of an issue of the repository on the forge. */
  issueUrl(repository: RepositoryReference, number: number): string;
  /** One page of the repository's issues, newest created first, filtered on the forge's side. */
  issues(repository: RepositoryReference, query: ListQuery): Promise<Answered<ListPage<ListedIssue>>>;
  /** One page of the repository's pull requests, newest created first, filtered on the forge's side. */
  pullRequests(repository: RepositoryReference, query: ListQuery): Promise<Answered<ListPage<PullRequestSummary>>>;
  /** The repository's issues with these numbers, in one request and with no search, as a list page holds them; a number
   * the repository has no issue for is left out. */
  issuesByNumber(repository: RepositoryReference, numbers: number[]): Promise<Answered<ListedIssue[]>>;
  /** The repository's pull requests with these numbers, in one request and with no search, as a list page holds them;
   * a number the repository has no pull request for is left out. */
  pullRequestsByNumber(repository: RepositoryReference, numbers: number[]): Promise<Answered<PullRequestSummary[]>>;
  /** One issue of the repository with its rendered body, comments and relations. */
  issue(repository: RepositoryReference, number: number): Promise<Answered<IssueDetail>>;
  /** One pull request of the repository with its rendered body, timeline and merge requirements. */
  pullRequest(repository: RepositoryReference, number: number): Promise<Answered<PullRequestDetail>>;
  /** Carries out a direct action and returns what the forge said, unchanged. */
  act(repository: RepositoryReference, action: DirectAction): Promise<string>;
}
