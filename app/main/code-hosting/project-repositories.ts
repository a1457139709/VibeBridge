import type { DirectAction, DirectActionResult, IssueDetailResult, IssueFilter, IssuePageResult, MergeRequestDetailResult, MergeRequestPageResult, RepositoryChoices, RepositoryReference } from '../../shared/code-hosting';
import type { Project } from '../../shared/model';
import { commandEnvironment } from '../../terminal/environment';
import type { CommandEnvironment } from './platform';
import { bindableRepository, repositoryChoices } from './binding';
import { directAction, issueDetail, issuePage, mergeRequestDetail, mergeRequestPage } from './issues';

/** The Code Hosting Platform reads the Workbench makes for its projects. Platform CLIs and git run in the
 * login-shell environment Agent Runs get, read once per Workbench. */
export class ProjectRepositories {
  private environment?: Promise<CommandEnvironment>;
  private commandEnvironment() { return this.environment ??= commandEnvironment().catch(error => { this.environment = undefined; throw error; }); }
  /** The repositories the platform CLI's signed-in account may bind to the project, with the one its directory's `origin` points to. */
  async choices(project: Project): Promise<RepositoryChoices> {
    return repositoryChoices(project, await this.commandEnvironment());
  }
  /** The repository as a binding, once its platform lists it among the repositories the account may bind. */
  bindable(repository: RepositoryReference) { return bindableRepository(repository, () => this.commandEnvironment()); }
  /** One page of the issues of the project's bound repository, filtered by its platform; null reads the first page. */
  async issuePage(project: Project, filter: IssueFilter, cursor: string | null): Promise<IssuePageResult> {
    return issuePage(project.repository, filter, cursor, await this.commandEnvironment());
  }
  /** One page of the merge requests of the project's bound repository, filtered by its platform; null reads the first page. */
  async mergeRequestPage(project: Project, filter: IssueFilter, cursor: string | null): Promise<MergeRequestPageResult> {
    return mergeRequestPage(project.repository, filter, cursor, await this.commandEnvironment());
  }
  /** The project's bound repository's issue with that number, with its comments and relations, read from its platform. */
  async issueDetail(project: Project, number: number): Promise<IssueDetailResult> {
    return issueDetail(project.repository, number, await this.commandEnvironment());
  }
  /** The project's bound repository's merge request with that number, with its conversation and merge state, read from its platform. */
  async mergeRequestDetail(project: Project, number: number): Promise<MergeRequestDetailResult> {
    return mergeRequestDetail(project.repository, number, await this.commandEnvironment());
  }
  /** Takes a direct action on an issue or merge request of the project's bound repository, on its platform. */
  async directAction(project: Project, action: DirectAction): Promise<DirectActionResult> {
    return directAction(project.repository, action, await this.commandEnvironment());
  }
}
