import { message, detail } from '../../shared/messages';
import { repositoryReferenceSchema, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import { forges, defaultForge } from './forges';
import { ForgeError } from './forge';
import { originUrl } from './origin';

/** The repositories a project can bind, at their current paths: from the forge and host of its binding, or the default
 * forge and its default host when unbound, with the one that `origin` of `directory` points at. */
export async function repositoryChoices(
  bound: RepositoryReference | null,
  directory: string,
): Promise<RepositoryChoices> {
  const forge = forges[bound?.forge ?? defaultForge];
  const host = bound?.host ?? forge.defaultHost;
  try {
    const [account, listed, origin] = await Promise.all([
      forge.account(host),
      forge.repositories(host),
      originUrl(directory),
    ]);
    const repositories = listed.map(({ id, path }): RepositoryReference => ({ forge: forge.id, host, id, path }));
    const originPath = origin === null ? null : forge.remotePath(host, origin);
    const offered =
      originPath === null
        ? null
        : forge.find(
            originPath,
            listed.map(item => item.path),
          );
    return {
      ok: true,
      forge: forge.presentation,
      account,
      repositories,
      origin: repositories.find(item => item.path === offered) ?? null,
    };
  } catch (error) {
    if (error instanceof ForgeError) return { ok: false, failure: error.failure(forge) };
    throw error;
  }
}

/** The repository as its forge currently lists it, found by its ID, at its listed path; null stays null and needs no list. */
export async function listedRepository(repository: RepositoryReference | null): Promise<RepositoryReference | null> {
  if (repository === null) return null;
  const parsed = repositoryReferenceSchema.safeParse(repository);
  if (!parsed.success) throw new Error(message('repositoryNotListed'));
  const { forge: id, host } = parsed.data;
  const forge = forges[id];
  let listed;
  try {
    listed = await forge.repositories(host);
  } catch (error) {
    if (error instanceof ForgeError)
      throw new Error(
        message('projectEditListFailed', {
          reason: detail(error.detail || message('forgeNotInstalled', { cli: forge.presentation.cli })),
        }),
      );
    throw error;
  }
  const found = listed.find(item => item.id === parsed.data.id);
  if (!found) throw new Error(message('repositoryNotListed'));
  return { forge: id, host, id: found.id, path: found.path };
}
