import { nestedMessage, message } from '../../shared/messages';
import { sameRepository, type RepositoryChoices, type RepositoryReference } from '../../shared/forge/forge';
import type { BoundRepository } from './results';
import { currentListedReference, repositoryChoices, RepositoryListUnreadable } from './repositories';
import { defaultForge, forges } from './forges';
import type { ProjectStore } from '../persistence/storage';

export class RepositoryBindings {
  private bindings: Map<string, RepositoryReference>;
  constructor(
    stored: Record<string, RepositoryReference>,
    private store: Pick<ProjectStore, 'bind' | 'unbind'>,
  ) {
    this.bindings = new Map(Object.entries(stored));
  }
  get(projectId: string) {
    return this.bindings.get(projectId) ?? null;
  }
  view(projectId: string) {
    const repository = this.get(projectId);
    const forge = forges[repository?.forge ?? defaultForge];
    return { repository, forge: forge.presentation, capabilities: forge.capabilities };
  }
  require(projectId: string) {
    const repository = this.bindings.get(projectId);
    if (!repository) throw new Error(message('noRepositoryBound'));
    return repository;
  }
  forForgeCall(projectId: string, follow: (found: RepositoryReference) => void): BoundRepository {
    return { repository: this.require(projectId), follow };
  }
  async choices(
    projectId: string,
    directory: string,
    follow: (found: RepositoryReference) => void,
  ): Promise<RepositoryChoices> {
    const bound = this.get(projectId);
    const choices = await repositoryChoices(bound, directory);
    const listed = choices.ok && choices.repositories.find(item => sameRepository(item, bound));
    if (listed && bound && listed.path !== bound.path) follow(listed);
    return choices;
  }
  async findListed(repository: RepositoryReference) {
    return currentListedReference(repository).catch((error: unknown): never => {
      if (error instanceof RepositoryListUnreadable)
        throw new Error(message('bindListFailed', { reason: nestedMessage(error.reason) }));
      throw error;
    });
  }
  async bind(projectId: string, repository: RepositoryReference) {
    await this.store.bind(projectId, repository);
    this.bindings.set(projectId, repository);
  }
  async unbind(projectId: string) {
    await this.store.unbind(projectId);
    this.bindings.delete(projectId);
  }
  forget(projectId: string) {
    this.bindings.delete(projectId);
  }
  async follow(projectId: string, found: RepositoryReference) {
    const bound = this.get(projectId);
    if (!bound || !sameRepository(bound, found) || bound.path === found.path) return false;
    await this.store.bind(projectId, found);
    this.bindings.set(projectId, found);
    return true;
  }
}
