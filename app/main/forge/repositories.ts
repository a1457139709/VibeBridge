import { message, detail } from '../../shared/messages';
import { forgeIdSchema, type RepositoryChoices, type RepositoryReference } from '../../shared/forge';
import { forges, defaultForge } from './forges';
import { ForgeError } from './forge';
import { originUrl } from './origin';

/** The repositories a project can bind, from the forge of its binding, or the default forge when unbound,
 * with the one that `origin` of `directory` points at. */
export async function repositoryChoices(bound: RepositoryReference | null, directory: string): Promise<RepositoryChoices> {
  const forge = forges[bound?.forge ?? defaultForge];
  try {
    const [account, listed, origin] = await Promise.all([forge.account(), forge.repositories(), originUrl(directory)]);
    // The bound repository keeps its stored spelling wherever the forge lists the same repository.
    const repositories = bound ? listed.map(path => forge.find(bound.path, [path]) ? bound.path : path) : listed;
    const originPath = origin === null ? null : forge.remotePath(origin);
    const offered = originPath === null ? null : forge.find(originPath, repositories);
    return { ok: true, forge: forge.presentation, account,
      repositories: repositories.map(path => ({ forge: forge.id, path })),
      origin: offered === null ? null : { forge: forge.id, path: offered } };
  } catch (error) {
    if (error instanceof ForgeError) return { ok: false, failure: error.failure(forge) };
    throw error;
  }
}

/** The repository as its forge currently lists it, in the listed spelling; null stays null and needs no list. */
export async function listedRepository(repository: RepositoryReference | null): Promise<RepositoryReference | null> {
  if (repository === null) return null;
  const id = forgeIdSchema.safeParse(repository?.forge);
  if (!id.success || typeof repository.path !== 'string') throw new Error(message('repositoryNotListed'));
  const forge = forges[id.data];
  let listed: string[];
  try { listed = await forge.repositories(); }
  catch (error) {
    if (error instanceof ForgeError) throw new Error(message('projectEditListFailed', { reason: detail(error.detail
      || message('forgeNotInstalled', { cli: forge.presentation.cli })) }));
    throw error;
  }
  const path = forge.find(repository.path, listed);
  if (path === null) throw new Error(message('repositoryNotListed'));
  return { forge: id.data, path };
}
