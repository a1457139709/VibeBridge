import { message, detail } from '../../shared/messages';
import { repositoryReferenceSchema, type RepositoryChoices, type RepositoryReference } from '../../shared/code-hosting';
import type { Project } from '../../shared/model';
import { PlatformError, type CommandEnvironment } from './platform';
import { defaultPlatform, platforms } from './platforms';
import { originUrl } from './origin';

/** The repositories the platform CLI's signed-in account may bind to the project, with the one its directory's `origin` points to. */
export async function repositoryChoices(project: Project, environment: CommandEnvironment): Promise<RepositoryChoices> {
  const platform = platforms[project.repository?.platform ?? defaultPlatform];
  try {
    const [{ account, paths }, origin] = await Promise.all([platform.bindable(environment), originUrl(project.directory, environment)]);
    const originPath = origin && platform.remotePath(origin)?.toLowerCase();
    const suggested = paths.find(path => path.toLowerCase() === originPath);
    const reference = (path: string): RepositoryReference => ({ platform: platform.description.id, path });
    return { ok: true, platform: platform.description, account, repositories: paths.map(reference), suggested: suggested ? reference(suggested) : null };
  } catch (error) {
    if (error instanceof PlatformError) return { ok: false, failure: error.failure };
    throw error;
  }
}

/** The repository as a binding, once its platform lists it among the repositories the account may bind. */
export async function bindableRepository(repository: RepositoryReference, environment: () => Promise<CommandEnvironment>): Promise<RepositoryReference> {
  const parsed = repositoryReferenceSchema.safeParse(repository);
  if (!parsed.success) throw new Error(message('repositoryNotListed'));
  const platform = platforms[parsed.data.platform];
  let paths: string[];
  try { ({ paths } = await platform.bindable(await environment())); }
  catch (error) {
    if (error instanceof PlatformError) throw new Error(message('repositoryListFailed', { platform: platform.description.name, reason: detail(error.failure.output || error.failure.kind) }));
    throw error;
  }
  if (!paths.includes(parsed.data.path)) throw new Error(message('repositoryNotListed'));
  return parsed.data;
}
