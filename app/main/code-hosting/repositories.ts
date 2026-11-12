import { message, detail } from '../../shared/messages';
import { codeHostingPlatformIdSchema, type RepositoryChoices, type RepositoryReference } from '../../shared/code-hosting';
import { codeHostingPlatforms, defaultPlatform } from './platforms';
import { CodeHostingError } from './platform';
import { originUrl } from './origin';

/** The repositories a project can bind, from the platform of its binding, or the default platform when unbound,
 * with the one that `origin` of `directory` points at. */
export async function repositoryChoices(bound: RepositoryReference | null, directory: string): Promise<RepositoryChoices> {
  const platform = codeHostingPlatforms[bound?.platform ?? defaultPlatform];
  try {
    const [account, listed, origin] = await Promise.all([platform.account(), platform.repositories(), originUrl(directory)]);
    // The bound repository keeps its stored spelling wherever the platform lists the same repository.
    const repositories = bound ? listed.map(path => platform.find(bound.path, [path]) ? bound.path : path) : listed;
    const originPath = origin === null ? null : platform.remotePath(origin);
    const offered = originPath === null ? null : platform.find(originPath, repositories);
    return { ok: true, platform: platform.presentation, account,
      repositories: repositories.map(path => ({ platform: platform.id, path })),
      origin: offered === null ? null : { platform: platform.id, path: offered } };
  } catch (error) {
    if (error instanceof CodeHostingError) return { ok: false, failure: { kind: error.kind, detail: error.detail, platform: platform.presentation } };
    throw error;
  }
}

/** The repository as its platform currently lists it, in the listed spelling; null stays null and needs no list. */
export async function listedRepository(repository: RepositoryReference | null): Promise<RepositoryReference | null> {
  if (repository === null) return null;
  const id = codeHostingPlatformIdSchema.safeParse(repository?.platform);
  if (!id.success || typeof repository.path !== 'string') throw new Error(message('repositoryNotListed'));
  const platform = codeHostingPlatforms[id.data];
  let listed: string[];
  try { listed = await platform.repositories(); }
  catch (error) {
    if (error instanceof CodeHostingError) throw new Error(message('projectEditListFailed', { reason: detail(error.detail
      || message('codeHostingNotInstalled', { cli: platform.presentation.cli })) }));
    throw error;
  }
  const path = platform.find(repository.path, listed);
  if (path === null) throw new Error(message('repositoryNotListed'));
  return { platform: id.data, path };
}
