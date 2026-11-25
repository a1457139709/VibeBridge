import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings/settings';
import type { ProjectView, Snapshot } from '../../../app/shared/model';
import type {
  Check,
  CheckState,
  ForgeCapabilities,
  IssueDetailResult,
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReference,
} from '../../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './workbench';
import { forgeSidebarData, workbenchEvents } from './forge-sidebar-data';
import { githubCapabilities, githubForge, githubView, githubRepository } from './forge';
import { t } from './localization';
import { issue as listedIssue, pullRequest as listedPullRequest } from './forge-lists';
import { forgeSidebar, detailHeading } from './sidebar-queries';

export const repositoryUrl = 'https://github.com/octo/alpha';
export const listed = { title: 'Read-only detail' };
export const listedIssueTitle = 'Spec';
export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
export const links = { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` };
export const detail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { createdAt: hoursAgo(50) });
  return {
    ...summary,
    url: `${repositoryUrl}/pull/${number}`,
    changesUrl: `${repositoryUrl}/pull/${number}/files`,
    head: 'feature',
    base: 'main',
    body: '',
    timeline: [],
    earlierEntries: 0,
    closingIssues: [],
    links,
    reviewDecision: null,
    checks: { state: null, counts: [], total: 0, url: `${repositoryUrl}/pull/${number}/checks`, listed: [] },
    mergeState: 'clean',
    mergeOptions: { methods: ['merge', 'squash', 'rebase'], defaultMethod: 'merge', queue: false },
    canWrite: true,
    ...extra,
  };
};
export const success: CheckState = { outcome: 'success', tone: 'passed' };
export const failure: CheckState = { outcome: 'failure', tone: 'failed' };
export const timedOut: CheckState = { outcome: 'timedOut', tone: 'failed' };
export const inProgress: CheckState = { outcome: 'inProgress', tone: 'pending' };
export const skipped: CheckState = { outcome: 'skipped', tone: 'neutral' };
export const check = (
  name: string,
  state: CheckState = success,
  extra: Partial<Omit<Check, keyof CheckState>> = {},
): Check => ({
  ...state,
  workflow: null,
  name,
  description: null,
  required: false,
  startedAt: null,
  completedAt: null,
  url: `${repositoryUrl}/runs/${name}`,
  ...extra,
});
export const checks = (
  listed: Check[],
  extra: Partial<PullRequestDetail['checks']> = {},
): PullRequestDetail['checks'] => ({
  state: success,
  counts: [{ ...success, count: listed.length }],
  total: listed.length,
  url: `${repositoryUrl}/pull/12/checks`,
  listed,
  ...extra,
});

interface Request {
  kind: 'issue' | 'pullRequest';
  number: number;
  answer(result: IssueDetailResult | PullRequestDetailResult): void;
}

export function renderWorkbench({
  capabilities = githubCapabilities,
  closingPullRequests = [],
}: { capabilities?: ForgeCapabilities; closingPullRequests?: PullRequestReference[] } = {}) {
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
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [project],
  };
  const requests: Request[] = [];
  const ask = <Result extends IssueDetailResult | PullRequestDetailResult>(kind: Request['kind'], number: number) => {
    const answer = deferred<Result>();
    requests.push({ kind, number, answer: answer.resolve });
    return answer.promise;
  };
  const events = workbenchEvents();
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: events.subscribe,
    saveSidebar: async () => {},
    activateProject: async () => {},
    saveLayout: async () => {},
    ...forgeSidebarData(
      {
        issuePage: async () => ({
          ok: true,
          items: [listedIssue(3, { title: listedIssueTitle })],
          nextCursor: null,
          labels: [],
          counts: { open: 1, closed: 0 },
        }),
        pullRequestPage: async () => ({
          ok: true,
          items: [listedPullRequest(12, { title: listed.title })],
          nextCursor: null,
          labels: [],
          counts: { open: 1, closed: 0 },
        }),
        issueDetail: async (_, number) => {
          const result = await ask<IssueDetailResult>('issue', number);
          return result.ok ? { ...result, issue: { ...result.issue, closingPullRequests } } : result;
        },
        pullRequestDetail: (_, number) => ask<PullRequestDetailResult>('pullRequest', number),
      },
      events.emit,
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

export const pane = () => within(forgeSidebar()).getByRole('region', { name: t('pullRequestDetail') });
export const mergeArea = () => within(pane()).getByRole('region', { name: t('mergeRequirements') });
export const rowOf = (name: string) => within(mergeArea()).getByRole('group', { name });
export const shownRow = (name: string, description: string) =>
  within(mergeArea()).getByRole('group', { name, description });

export async function openPullRequest(
  pullRequest: PullRequestDetail,
  options: Parameters<typeof renderWorkbench>[0] = {},
) {
  const view = renderWorkbench(options);
  await view.user.click(
    within(await screen.findByRole('complementary', { name: githubForge.name })).getByRole('tab', {
      name: t('pullRequestsTab'),
    }),
  );
  await view.user.click(await within(forgeSidebar()).findByRole('button', { name: listed.title }));
  const first = await view.request(1);
  assert.deepEqual([first.kind, first.number], ['pullRequest', 12]);
  first.answer({ ok: true, pullRequest });
  await detailHeading(pane(), pullRequest.title, 12);
  return view;
}
