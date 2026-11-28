import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings/settings';
import type { ProjectView, Snapshot } from '../../../app/shared/model';
import type { DirectAction, DirectActionResult, IssueDetail, PullRequestDetail } from '../../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './workbench';
import { forgeSidebarData, workbenchEvents } from './forge-sidebar-data';
import { testForge, testForgeUrl, testForgeView, testForgeRepository } from './forge';
import { issue as listedIssue, pullRequest as listedPullRequest } from './forge-lists';
import { requireValue } from '../../../app/renderer/common/required';
import { t } from './localization';
import { detailHeading, forgeSidebar } from './sidebar-queries';

export const repositoryUrl = `${testForgeUrl}/ada/alpha`;
export const titles = { issue: 'Spec', pullRequest: 'Read-only detail' };
const links = { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` };
export const issueDetail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => {
  const {
    blockedBy: _,
    unlistedBlockers: __,
    parent: ___,
    subIssues: ____,
    ...summary
  } = listedIssue(number, { title: titles.issue });
  return {
    ...summary,
    url: `${repositoryUrl}/issues/${number}`,
    author: 'lin',
    assignees: [],
    body: '',
    comments: [],
    commentCount: 0,
    parent: null,
    subIssues: [],
    subIssueProgress: { closed: 0, total: 0 },
    blockedBy: [],
    blockedByTotal: 0,
    blocking: [],
    blockingTotal: 0,
    closingPullRequests: [],
    links,
    canWrite: true,
    ...extra,
  };
};
export const pullDetail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { title: titles.pullRequest });
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

export interface Forge {
  issue?: IssueDetail;
  pullRequest?: PullRequestDetail;
}
interface ActionRequest {
  action: DirectAction;
  answer(result: DirectActionResult): void;
}

function renderWorkbench(forge: Forge) {
  const project: ProjectView = {
    id: 'alpha',
    name: 'Alpha',
    directory: '/work/alpha',
    layout: { panel: 'panel' },
    tray: [],
    repository: testForgeRepository('ada/alpha'),
    ...testForgeView,
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
  const actions: ActionRequest[] = [];
  const reads = { issue: 0, pullRequest: 0, pages: 0, rows: 0 };
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
        issuePage: async () => {
          reads.pages++;
          return {
            ok: true,
            items: [listedIssue(3, { title: titles.issue })],
            nextCursor: null,
            labels: [],
            counts: { open: 1, closed: 0 },
          };
        },
        pullRequestPage: async () => {
          reads.pages++;
          return {
            ok: true,
            items: [listedPullRequest(12, { title: titles.pullRequest })],
            nextCursor: null,
            labels: [],
            counts: { open: 1, closed: 0 },
          };
        },
        issuesByNumber: async (_, numbers) => {
          reads.rows++;
          const { title, state, closedAs } = requireValue(forge.issue, 'the forge issue');
          return { ok: true, items: numbers.includes(3) ? [listedIssue(3, { title, state, closedAs })] : [] };
        },
        issueDetail: async () => {
          reads.issue++;
          return { ok: true, issue: structuredClone(requireValue(forge.issue, 'the forge issue')) };
        },
        pullRequestDetail: async () => {
          reads.pullRequest++;
          return { ok: true, pullRequest: structuredClone(requireValue(forge.pullRequest, 'the forge pull request')) };
        },
      },
      events.emit,
    ),
    performDirectAction: (_, action) => {
      const answer = deferred<DirectActionResult>();
      actions.push({ action, answer: answer.resolve });
      return answer.promise;
    },
  });
  render(<App />);
  const action = (count: number) =>
    waitFor(() => {
      assert.equal(actions.length, count, 'direct actions asked for');
      return actions[count - 1];
    });
  return { user: userEvent.setup(), action, reads };
}

export const issuePane = () => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') });
export const pullPane = () => within(forgeSidebar()).getByRole('region', { name: t('pullRequestDetail') });
export const forgeName = testForge.name;
export const mergeButtons = () =>
  within(within(pullPane()).getByRole('region', { name: t('mergeRequirements') }))
    .queryAllByRole('button')
    .map(button => button.textContent);
export const failure = (detail: string): DirectActionResult => ({
  ok: false,
  failure: { kind: 'transient', detail, forge: testForge },
});

export async function openIssue(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(
    await within(await screen.findByRole('complementary', { name: forgeName })).findByRole('button', {
      name: titles.issue,
    }),
  );
  await detailHeading(issuePane(), titles.issue, 3);
  return view;
}
export async function openPullRequest(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(
    within(await screen.findByRole('complementary', { name: forgeName })).getByRole('tab', {
      name: t('pullRequestsTab'),
    }),
  );
  await view.user.click(await within(forgeSidebar()).findByRole('button', { name: titles.pullRequest }));
  await detailHeading(pullPane(), titles.pullRequest, 12);
  return view;
}
