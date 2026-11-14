import { message } from '../../shared/messages';
import type { DirectAction, DirectActionResult, IssueDetailResult, IssuePage, ListQuery, PullRequestDetailResult, PullRequestPage, RepositoryChoices, RepositoryReference } from '../../shared/forge';
import { directAction, issueDetail, issuePage, pullRequestDetail, pullRequestPage } from './results';
import { repositoryChoices } from './repositories';
import { defaultForge, forges } from './forges';

/** Each project's Repository Binding as stored, and what the Workbench reads from and does on a project's bound
 * repository. `exists` throws when the project is missing. */
export class BoundRepositories {
  private bindings: Map<string, RepositoryReference>;
  constructor(stored: Record<string, RepositoryReference>, private exists: (projectId: string) => void) {
    this.bindings = new Map(Object.entries(stored));
  }
  /** The project's Repository Binding, or null when it has none. */
  get(projectId: string) { return this.bindings.get(projectId) ?? null; }
  set(projectId: string, repository: RepositoryReference | null) {
    if (repository) this.bindings.set(projectId, repository); else this.bindings.delete(projectId);
  }
  /** The forge fields of a project's view: its binding, and the Forge its sidebar shows with that Forge's capabilities. */
  view(projectId: string) {
    const repository = this.get(projectId);
    const forge = forges[repository?.forge ?? defaultForge];
    return { repository, forge: forge.presentation, capabilities: forge.capabilities };
  }
  /** The project's bound repository; it is an error to ask for a project without one. */
  bound(projectId: string) {
    this.exists(projectId);
    const repository = this.bindings.get(projectId);
    if (!repository) throw new Error(message('noRepositoryBound'));
    return repository;
  }
  /** The repositories the project can bind, with the one that `origin` of `directory` (the directory as the user is editing it) points at. */
  async choices(projectId: string, directory: string): Promise<RepositoryChoices> {
    this.exists(projectId);
    return repositoryChoices(this.get(projectId), directory);
  }
  /** One page of the issues of the project's bound repository, as `query` asks. */
  async issuePage(projectId: string, query: ListQuery): Promise<IssuePage> { return issuePage(this.bound(projectId), query); }
  /** One page of the pull requests of the project's bound repository, as `query` asks. */
  async pullRequestPage(projectId: string, query: ListQuery): Promise<PullRequestPage> { return pullRequestPage(this.bound(projectId), query); }
  /** One issue of the project's bound repository, with its rendered body, comments and relations. */
  async issueDetail(projectId: string, number: number): Promise<IssueDetailResult> { return issueDetail(this.bound(projectId), number); }
  /** One pull request of the project's bound repository, with its rendered body and what stands between it and a merge. */
  async pullRequestDetail(projectId: string, number: number): Promise<PullRequestDetailResult> { return pullRequestDetail(this.bound(projectId), number); }
  /** Carries out a direct action on an issue or pull request of the project's bound repository; the forge's text comes back either way. */
  async directAction(projectId: string, action: DirectAction): Promise<DirectActionResult> { return directAction(this.bound(projectId), action); }
}
