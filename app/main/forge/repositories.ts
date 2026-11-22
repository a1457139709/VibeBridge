import { message } from '../../shared/messages';
import { repositoryReferenceSchema, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import { forges, defaultForge } from './forges';
import { ForgeError } from './forge';
import { originUrl } from './origin';

export async function repositoryChoices(
  bound: RepositoryReference | null,
  directory: string,
): Promise<RepositoryChoices> {
  const forge = forges[bound?.forge ?? defaultForge];
  const host = bound?.host ?? forge.defaultHost;
  try {
    const [account, listed, remoteUrl] = await Promise.all([
      forge.account(host),
      forge.repositories(host),
      originUrl(directory),
    ]);
    const repositories = listed.map(({ id, path }): RepositoryReference => ({ forge: forge.id, host, id, path }));
    const originPath = remoteUrl === null ? null : forge.remotePath(host, remoteUrl);
    const offered =
      originPath === null
        ? null
        : forge.matchListedPath(
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

export class RepositoryListUnreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function currentListedReference(repository: RepositoryReference): Promise<RepositoryReference> {
  const parsed = repositoryReferenceSchema.safeParse(repository);
  if (!parsed.success) throw new Error(message('repositoryNotListed'));
  const { forge: forgeId, host } = parsed.data;
  const forge = forges[forgeId];
  let listed;
  try {
    listed = await forge.repositories(host);
  } catch (error) {
    if (error instanceof ForgeError)
      throw new RepositoryListUnreadable(error.detail || message('forgeNotInstalled', { cli: forge.presentation.cli }));
    throw error;
  }
  const found = listed.find(item => item.id === parsed.data.id);
  if (!found) throw new Error(message('repositoryNotListed'));
  return { forge: forgeId, host, id: found.id, path: found.path };
}
