import type { DesktopAPI } from '../../../app/shared/api';
import type {
  IssueDetailResult,
  IssuePage,
  IssuesByNumber,
  ListQuery,
  PullRequestDetailResult,
  PullRequestPage,
  PullRequestsByNumber,
  RepositoryChoices,
} from '../../../app/shared/forge/forge';
import type { ForgeSidebarEvent } from '../../../app/shared/forge/sidebar-data';
import type { WorkbenchEvent } from '../../../app/shared/model';
import { ForgeSidebarData } from '../../../app/main/forge/forge-sidebar-data';
import { githubForge } from './forge';

export interface ForgeAnswers {
  issuePage?(projectId: string, query: ListQuery): Promise<IssuePage>;
  pullRequestPage?(projectId: string, query: ListQuery): Promise<PullRequestPage>;
  issuesByNumber?(projectId: string, numbers: number[]): Promise<IssuesByNumber>;
  pullRequestsByNumber?(projectId: string, numbers: number[]): Promise<PullRequestsByNumber>;
  repositoryChoices?(projectId: string, directory: string): Promise<RepositoryChoices>;
  issueDetail?(projectId: string, number: number): Promise<IssueDetailResult>;
  pullRequestDetail?(projectId: string, number: number): Promise<PullRequestDetailResult>;
}

const unanswered = (read: string) => Promise.reject(new Error(`Unexpected forge read: ${read}`));

export function forgeSidebarData(
  answers: ForgeAnswers,
  emit: (event: ForgeSidebarEvent) => void,
  directoryOf: (projectId: string) => string = projectId => `/work/${projectId}`,
) {
  const data = new ForgeSidebarData({
    issuePage: (projectId, query) => answers.issuePage?.(projectId, query) ?? unanswered('issuePage'),
    pullRequestPage: (projectId, query) => answers.pullRequestPage?.(projectId, query) ?? unanswered('pullRequestPage'),
    issuesByNumber: (projectId, numbers) =>
      answers.issuesByNumber?.(projectId, numbers) ?? unanswered('issuesByNumber'),
    pullRequestsByNumber: (projectId, numbers) =>
      answers.pullRequestsByNumber?.(projectId, numbers) ?? unanswered('pullRequestsByNumber'),
    repositoryChoices: projectId =>
      answers.repositoryChoices?.(projectId, directoryOf(projectId)) ?? unanswered('repositoryChoices'),
    issueDetail: (projectId, number) => answers.issueDetail?.(projectId, number) ?? unanswered('issueDetail'),
    pullRequestDetail: (projectId, number) =>
      answers.pullRequestDetail?.(projectId, number) ?? unanswered('pullRequestDetail'),
    forge: () => githubForge,
    emit,
  });
  return {
    showForgeList: (projectId, view) => data.showList(projectId, view),
    reportForgeSidebarPresence: presence => data.reportPresence(presence),
    loadMoreForgeList: projectId => data.loadMore(projectId),
    showForgeRows: (projectId, numbers) => data.showRows(projectId, numbers),
    refreshForgeList: projectId => data.refresh(projectId),
    showRepositoryChoices: projectId => data.showRepositoryChoices(projectId),
    showForgeDetail: (projectId, item) => data.showDetail(projectId, item),
    reportForgeRowResting: (projectId, item) => data.reportRestingOn(projectId, item),
    reportForgeItemChanged: (projectId, item) => data.reloadChanged(projectId, item),
  } satisfies Partial<DesktopAPI>;
}

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
