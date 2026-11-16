import { message } from '../../shared/messages';
import { sameRepository, type DirectAction, type DirectActionResult, type IssueDetailResult, type IssuePage, type ListQuery, type PullRequestDetailResult, type PullRequestPage, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import { directAction, issueDetail, issuePage, pullRequestDetail, pullRequestPage, type Bound } from './results';
import { repositoryChoices } from './repositories';
import { defaultForge, forges } from './forges';
import type { ProjectStore } from '../persistence/storage';

/** What BoundRepositories needs from the Workbench: `requireProject` throws when the project is missing; `serially`
 * runs work in the Workbench's operation queue. */
export interface BindingHost {
  requireProject(projectId: string): void;
  store: Pick<ProjectStore, 'bind'>;
  serially(work: () => Promise<void>): Promise<void>;
  changed(): void;
  report(message: string): void;
}

/** Each project's Repository Binding as stored, and what the Workbench reads from and does on a project's bound
 * repository. Whenever the forge shows a bound repository at another path (renamed or transferred), the binding follows it. */
export class BoundRepositories {
  private bindings: Map<string, RepositoryReference>;
  constructor(stored: Record<string, RepositoryReference>, private host: BindingHost) {
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
    this.host.requireProject(projectId);
    const repository = this.bindings.get(projectId);
    if (!repository) throw new Error(message('noRepositoryBound'));
    return repository;
  }
  /** The project's bound repository for a forge call, which reports where the forge found it. */
  private on(projectId: string): Bound {
    return { repository: this.bound(projectId), moved: repository => this.moved(projectId, repository) };
  }
  /** Stores the binding at the path the forge found its repository at, unless the project was rebound, unbound or deleted meanwhile. */
  private moved(projectId: string, repository: RepositoryReference) {
    this.host.serially(async () => {
      const bound = this.get(projectId);
      if (!sameRepository(bound, repository) || bound!.path === repository.path) return;
      await this.host.store.bind(projectId, repository);
      this.set(projectId, repository);
      this.host.changed();
    }).catch(error => this.host.report((error as Error).message));
  }
  /** The repositories the project can bind, with the one that `origin` of `directory` (the directory as the user is editing it) points at. */
  async choices(projectId: string, directory: string): Promise<RepositoryChoices> {
    this.host.requireProject(projectId);
    const bound = this.get(projectId);
    const choices = await repositoryChoices(bound, directory);
    const listed = choices.ok && choices.repositories.find(item => sameRepository(item, bound));
    if (listed && listed.path !== bound!.path) this.moved(projectId, listed);
    return choices;
  }
  /** One page of the issues of the project's bound repository, as `query` asks. */
  async issuePage(projectId: string, query: ListQuery): Promise<IssuePage> { return issuePage(this.on(projectId), query); }
  /** One page of the pull requests of the project's bound repository, as `query` asks. */
  async pullRequestPage(projectId: string, query: ListQuery): Promise<PullRequestPage> { return pullRequestPage(this.on(projectId), query); }
  /** One issue of the project's bound repository, with its rendered body, comments and relations. */
  async issueDetail(projectId: string, number: number): Promise<IssueDetailResult> { return issueDetail(this.on(projectId), number); }
  /** One pull request of the project's bound repository, with its rendered body and what stands between it and a merge. */
  async pullRequestDetail(projectId: string, number: number): Promise<PullRequestDetailResult> { return pullRequestDetail(this.on(projectId), number); }
  /** Carries out a direct action on an issue or pull request of the project's bound repository; the forge's text comes back either way. */
  async directAction(projectId: string, action: DirectAction): Promise<DirectActionResult> { return directAction(this.on(projectId), action); }
}
