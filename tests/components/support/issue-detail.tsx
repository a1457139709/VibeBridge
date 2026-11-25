import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings/settings';
import type { ProjectView, Settings, Snapshot, WorkbenchEvent } from '../../../app/shared/model';
import type {
  ForgeCapabilities,
  IssueDetail,
  IssueDetailResult,
  IssueReference,
  ListedIssue,
} from '../../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './workbench';
import { forgeSidebarData } from './forge-sidebar-data';
import { githubCapabilities, githubForge, githubView, githubRepository } from './forge';
import { t } from './localization';
import { issue as listedIssue } from './forge-lists';
import { forgeSidebar } from './sidebar-queries';

export const repositoryUrl = 'https://github.com/octo/alpha';
export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
export const summary = (number: number, extra: Partial<ListedIssue> = {}): ListedIssue =>
  listedIssue(number, { createdAt: hoursAgo(3), ...extra });
export const reference = (number: number, extra: Partial<IssueReference> = {}): IssueReference => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  url: `${repositoryUrl}/issues/${number}`,
  ...extra,
});
export const detail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({
  ...summary(number),
  url: `${repositoryUrl}/issues/${number}`,
  author: 'mona',
  assignees: [],
  body: '',
  comments: [],
  commentCount: 0,
  parent: null,
  subIssues: [],
  subIssueProgress: { closed: 0, total: 0 },
  blockedBy: [],
  blocking: [],
  closingPullRequests: [],
  links: { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` },
  canWrite: true,
  ...extra,
});

interface Request {
  number: number;
  answer(result: IssueDetailResult): void;
  fail(error: Error): void;
}

export function renderWorkbench(
  issues: ListedIssue[],
  capabilities: ForgeCapabilities = githubCapabilities,
  settings: Partial<Settings> = {},
) {
  const project: ProjectView = {
    id: 'alpha',
    name: 'Alpha',
    directory: '/work/alpha',
    layout: { panel: 'panel' },
    tray: [],
    repository: githubRepository('octo/alpha'),
    ...githubView,
    capabilities,
    panels: [
      {
        id: 'panel',
        agent: 'codex',
        run: { id: 'run', panelId: 'panel', projectId: 'alpha', state: 'running', title: 'Alpha session' },
      },
    ],
  };
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: true, width: 380 },
    activeProjectId: 'alpha',
    settings: { ...defaultSettings(), ...settings },
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [project],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const requests: Request[] = [];
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    saveSidebar: async () => {},
    activateProject: async () => {},
    saveLayout: async () => {},
    ...forgeSidebarData(
      {
        issuePage: async () => ({
          ok: true,
          items: issues,
          nextCursor: null,
          labels: [],
          counts: { open: issues.length, closed: 0 },
        }),
        issueDetail: (projectId, number) => {
          assert.equal(projectId, 'alpha');
          const answer = deferred<IssueDetailResult>();
          requests.push({ number, answer: answer.resolve, fail: answer.reject });
          return answer.promise;
        },
      },
      event => {
        for (const listener of listeners) listener(event);
      },
    ),
  });
  render(<App />);
  const request = (count: number) =>
    waitFor(() => {
      assert.equal(requests.length, count, 'detail requests made');
      return requests[count - 1];
    });
  return { user: userEvent.setup(), request };
}

export const pane = () => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') });
export const row = (title: string) => waitFor(() => within(forgeSidebar()).getByRole('button', { name: title }));
