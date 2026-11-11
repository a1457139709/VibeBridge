import { message, detail } from '../../shared/messages';
import { directActionSchema, listFilterSchema, repositoryReferenceSchema, type DirectAction, type DirectActionResult, type IssueDetailResult, type IssuePageResult,
  type ListFailure, type ListFilter, type MergeRequestDetailResult, type MergeRequestPageResult, type RepositoryChoices,
  type RepositoryReference } from '../../shared/code-hosting';
import type { Project } from '../../shared/model';
import { commandEnvironment } from '../../terminal/environment';
import { platformResult, type CodeHostingPlatform, type CommandEnvironment } from './platform';
import { defaultPlatform, platforms } from './platforms';
import { originUrl } from './origin';

/** The project's Repository Binding; an unbound project reads nothing. */
function boundRepository(project: Project): RepositoryReference {
  if (!project.repository) throw new Error(message('repositoryUnbound'));
  return project.repository;
}

/** A list page, or the kind of failure the platform reported; an unreachable repository names the signed-in account when the platform tells it. */
async function listPage<Page>(platform: CodeHostingPlatform, environment: CommandEnvironment, filter: ListFilter, cursor: string | null,
  read: (filter: ListFilter) => Promise<Page>): Promise<{ ok: true; page: Page } | ListFailure> {
  const parsed = listFilterSchema.safeParse(filter);
  if (!parsed.success || (cursor !== null && typeof cursor !== 'string')) throw new Error(message('listFilterInvalid'));
  const result = await platformResult(() => read(parsed.data));
  if (result.ok) return { ok: true, page: result.value };
  const { failure } = result;
  if (failure.kind !== 'unreachable') return { ok: false, failure };
  // Missing and forbidden look alike, so the account tells the user whose access to check.
  const account = await platform.account(environment).catch(() => undefined);
  return account === undefined ? { ok: false, failure } : { ok: false, failure, account };
}

/**
 * Binding projects to repositories and reading their bound repository from its Code Hosting Platform. Platform CLIs
 * and git run in the login-shell environment Agent Runs get, read once per Workbench.
 */
export class ProjectRepositories {
  private environment?: Promise<CommandEnvironment>;
  private commandEnvironment() { return this.environment ??= commandEnvironment().catch(error => { this.environment = undefined; throw error; }); }

  /** The bound repository's platform and path, and the environment its CLI runs in. */
  private async bound(project: Project) {
    const { platform, path } = boundRepository(project);
    return { platform: platforms[platform], path, environment: await this.commandEnvironment() };
  }

  /** The repositories the platform CLI's signed-in account may bind to the project, with the one its directory's `origin` points to. */
  async choices(project: Project): Promise<RepositoryChoices> {
    const environment = await this.commandEnvironment();
    const platform = platforms[project.repository?.platform ?? defaultPlatform];
    const result = await platformResult(() => Promise.all([platform.bindable(environment), originUrl(project.directory, environment)]));
    if (!result.ok) return result;
    const [{ account, paths }, origin] = result.value;
    const originPath = origin && platform.remotePath(origin)?.toLowerCase();
    const suggested = paths.find(path => path.toLowerCase() === originPath);
    const reference = (path: string): RepositoryReference => ({ platform: platform.description.id, path });
    return { ok: true, platform: platform.description, account, repositories: paths.map(reference), suggested: suggested ? reference(suggested) : null };
  }

  /** The repository as a binding, once its platform lists it among the repositories the account may bind. */
  async bindable(repository: RepositoryReference): Promise<RepositoryReference> {
    const parsed = repositoryReferenceSchema.safeParse(repository);
    if (!parsed.success) throw new Error(message('repositoryNotListed'));
    const platform = platforms[parsed.data.platform];
    const environment = await this.commandEnvironment();
    const result = await platformResult(() => platform.bindable(environment));
    if (!result.ok) throw new Error(message('repositoryListFailed', { platform: platform.description.name, reason: detail(result.failure.output || result.failure.kind) }));
    if (!result.value.paths.includes(parsed.data.path)) throw new Error(message('repositoryNotListed'));
    return parsed.data;
  }

  /** One page of the issues of the project's bound repository, filtered by its platform; null reads the first page. */
  async issuePage(project: Project, filter: ListFilter, cursor: string | null): Promise<IssuePageResult> {
    const { platform, path, environment } = await this.bound(project);
    return listPage(platform, environment, filter, cursor, filter => platform.issues(environment, path, filter, cursor));
  }

  /** One page of the merge requests of the project's bound repository, filtered by its platform; null reads the first page. */
  async mergeRequestPage(project: Project, filter: ListFilter, cursor: string | null): Promise<MergeRequestPageResult> {
    const { platform, path, environment } = await this.bound(project);
    return listPage(platform, environment, filter, cursor, filter => platform.mergeRequests(environment, path, filter, cursor));
  }

  /** The project's bound repository's issue with that number, with its comments and relations, read from its platform. */
  async issueDetail(project: Project, number: number): Promise<IssueDetailResult> {
    const read = await this.detail(project, number, (platform, path, environment) => platform.issue(environment, path, number));
    return read.ok ? { ok: true, issue: read.value } : read;
  }

  /** The project's bound repository's merge request with that number, with its conversation and merge state, read from its platform. */
  async mergeRequestDetail(project: Project, number: number): Promise<MergeRequestDetailResult> {
    const read = await this.detail(project, number, (platform, path, environment) => platform.mergeRequest(environment, path, number));
    return read.ok ? { ok: true, mergeRequest: read.value } : read;
  }

  /** Takes a direct action on an issue or merge request of the project's bound repository, on its platform. */
  async directAction(project: Project, action: DirectAction): Promise<DirectActionResult> {
    const { platform, path, environment } = await this.bound(project);
    const parsed = directActionSchema.safeParse(action);
    if (!parsed.success) throw new Error(message('directActionInvalid'));
    const result = await platformResult(() => platform.act(environment, path, parsed.data));
    return result.ok ? { ok: true } : result;
  }

  private async detail<T>(project: Project, number: number, read: (platform: CodeHostingPlatform, path: string, environment: CommandEnvironment) => Promise<T>) {
    const { platform, path, environment } = await this.bound(project);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error(message('issueNumberInvalid'));
    return platformResult(() => read(platform, path, environment));
  }
}
