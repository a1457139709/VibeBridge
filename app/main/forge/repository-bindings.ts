import { detail, message } from '../../shared/messages';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import type { Bound } from './results';
import { listedRepository, repositoryChoices, RepositoryListUnreadable } from './repositories';
import { defaultForge, forges } from './forges';
import type { ProjectStore } from '../persistence/storage';

/** Each project's Repository Binding as stored. A binding follows its repository wherever the forge shows it at another
 * path (renamed or transferred): `forForgeCall` and `choices` hand such a path to the caller's `follow`, and the caller
 * writes it with `follow` here. */
export class RepositoryBindings {
  private bindings: Map<string, RepositoryReference>;
  constructor(
    stored: Record<string, RepositoryReference>,
    private store: Pick<ProjectStore, 'bind' | 'unbind'>,
  ) {
    this.bindings = new Map(Object.entries(stored));
  }
  /** The project's Repository Binding, or null when it has none. */
  get(projectId: string) {
    return this.bindings.get(projectId) ?? null;
  }
  /** The forge fields of a project's view: its binding, and the Forge its sidebar shows with that Forge's capabilities. */
  view(projectId: string) {
    const repository = this.get(projectId);
    const forge = forges[repository?.forge ?? defaultForge];
    return { repository, forge: forge.presentation, capabilities: forge.capabilities };
  }
  /** The project's bound repository; it is an error to ask for a project without one. */
  require(projectId: string) {
    const repository = this.bindings.get(projectId);
    if (!repository) throw new Error(message('noRepositoryBound'));
    return repository;
  }
  /** The project's bound repository for a forge call, which calls `follow` when the forge finds it at another path. */
  forForgeCall(projectId: string, follow: (found: RepositoryReference) => void): Bound {
    return { repository: this.require(projectId), follow };
  }
  /** The repositories the project can bind, with the one that `origin` of `directory` (the directory as the user is
   * editing it) points at; calls `follow` when the list shows the bound repository at another path. */
  async choices(
    projectId: string,
    directory: string,
    follow: (found: RepositoryReference) => void,
  ): Promise<RepositoryChoices> {
    const bound = this.get(projectId);
    const choices = await repositoryChoices(bound, directory);
    const listed = choices.ok && choices.repositories.find(item => sameRepository(item, bound));
    if (listed && listed.path !== bound!.path) follow(listed);
    return choices;
  }
  /** The repository as a fresh list from its forge shows it, for `bind`; throws when the list cannot be read or does
   * not show it. */
  async findListed(repository: RepositoryReference) {
    return listedRepository(repository).catch((error: unknown): never => {
      if (error instanceof RepositoryListUnreadable)
        throw new Error(message('bindListFailed', { reason: detail(error.reason) }));
      throw error;
    });
  }
  /** Binds the project to a repository `findListed` returned, replacing any binding it has. Runs in the Workbench's
   * operation queue. */
  async bind(projectId: string, repository: RepositoryReference) {
    await this.store.bind(projectId, repository);
    this.bindings.set(projectId, repository);
  }
  /** Removes the project's binding; it reads no list, so it works without the forge CLI. */
  async unbind(projectId: string) {
    await this.store.unbind(projectId);
    this.bindings.delete(projectId);
  }
  /** Drops the binding of a deleted project. */
  forget(projectId: string) {
    this.bindings.delete(projectId);
  }
  /** Stores the binding at the path the forge found its repository at and returns true; returns false when the project
   * was rebound, unbound or deleted meanwhile, or the path is unchanged. Runs in the Workbench's operation queue. */
  async follow(projectId: string, found: RepositoryReference) {
    const bound = this.get(projectId);
    if (!sameRepository(bound, found) || bound!.path === found.path) return false;
    await this.store.bind(projectId, found);
    this.bindings.set(projectId, found);
    return true;
  }
}
