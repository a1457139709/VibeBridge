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

export class ForgeError extends Error {
  constructor(
    readonly kind: ForgeFailureKind,
    readonly detail: string,
  ) {
    super(detail || kind);
  }
  failure(forge: Forge): ForgeFailure {
    return { kind: this.kind, detail: this.detail, forge: forge.presentation };
  }
}

export interface ListedRepository {
  id: string;
  path: string;
}

export interface Answered<T> {
  answeredBy: ListedRepository;
  data: T;
}

export interface Forge {
  id: ForgeId;
  defaultHost: string;
  presentation: ForgePresentation;
  capabilities: ForgeCapabilities;
  account(host: string): Promise<string>;
  repositories(host: string): Promise<ListedRepository[]>;
  remotePath(host: string, originUrl: string): string | null;
  matchListedPath(path: string, paths: string[]): string | null;
  locate(repository: RepositoryReference): Promise<string>;
  issueUrl(repository: RepositoryReference, number: number): string;
  issues(repository: RepositoryReference, query: ListQuery): Promise<Answered<ListPage<ListedIssue>>>;
  pullRequests(repository: RepositoryReference, query: ListQuery): Promise<Answered<ListPage<PullRequestSummary>>>;
  issuesByNumber(repository: RepositoryReference, numbers: number[]): Promise<Answered<ListedIssue[]>>;
  pullRequestsByNumber(repository: RepositoryReference, numbers: number[]): Promise<Answered<PullRequestSummary[]>>;
  issue(repository: RepositoryReference, number: number): Promise<Answered<IssueDetail>>;
  pullRequest(repository: RepositoryReference, number: number): Promise<Answered<PullRequestDetail>>;
  act(repository: RepositoryReference, action: DirectAction): Promise<string>;
}
