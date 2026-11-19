import type { DesktopAPI } from '../../../app/shared/api';
import type { IssuePage, ListQuery, PullRequestPage, RepositoryChoices } from '../../../app/shared/forge/forge';
import type { ForgeSidebarEvent } from '../../../app/shared/forge/sidebar-data';
import type { WorkbenchEvent } from '../../../app/shared/model';
import { ForgeSidebarData } from '../../../app/main/forge/forge-sidebar-data';
import { githubForge } from './forge';

/** What the forge answers the main process's Forge sidebar data with, per project. A read the test does not answer fails. */
export interface ForgeAnswers {
  issuePage?(projectId: string, query: ListQuery): Promise<IssuePage>;
  pullRequestPage?(projectId: string, query: ListQuery): Promise<PullRequestPage>;
  repositoryChoices?(projectId: string, directory: string): Promise<RepositoryChoices>;
}

const unanswered = (read: string) => () => Promise.reject(new Error(`Unexpected forge read: ${read}`));

/** The Workbench calls of the Forge sidebar's data, backed by the main process's own module over `answers`; what it
 * pushes goes to `emit`. `directoryOf` names each project's directory. */
export function forgeSidebarData(
  answers: ForgeAnswers,
  emit: (event: ForgeSidebarEvent) => void,
  directoryOf: (projectId: string) => string = projectId => `/work/${projectId}`,
): Pick<
  DesktopAPI,
  'showForgeList' | 'hideForgeList' | 'loadMoreForgeList' | 'refreshForgeList' | 'showRepositoryChoices'
> {
  const data = new ForgeSidebarData({
    issuePage: answers.issuePage ?? unanswered('issuePage'),
    pullRequestPage: answers.pullRequestPage ?? unanswered('pullRequestPage'),
    repositoryChoices: projectId =>
      (answers.repositoryChoices ?? unanswered('repositoryChoices'))(projectId, directoryOf(projectId)),
    forge: () => githubForge,
    emit,
  });
  return {
    showForgeList: (projectId, view) => data.showList(projectId, view),
    hideForgeList: async projectId => data.hideList(projectId),
    loadMoreForgeList: projectId => data.loadMore(projectId),
    refreshForgeList: projectId => data.refresh(projectId),
    showRepositoryChoices: projectId => data.showRepositoryChoices(projectId),
  };
}

/** Where a test's Workbench pushes events: `subscribe` for the Workbench API, and `emit` to push one. */
export function workbenchEvents() {
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  return {
    subscribe(listener: (event: WorkbenchEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event: WorkbenchEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}
