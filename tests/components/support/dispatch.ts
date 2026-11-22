import assert from 'node:assert/strict';
import { screen, waitFor, within } from '@testing-library/react';
import type { DispatchRecordView, DispatchRequest } from '../../../app/shared/dispatch';
import type { Snapshot } from '../../../app/shared/model';
import type { IssueDetail } from '../../../app/shared/forge/forge';
import { issue, page, renderWorkbench, sidebar, summary } from './forge-lists';
import { githubCapabilities } from './forge';
import { requireValue } from '../../../app/renderer/common/required';

export function withPanels(snapshot: Snapshot) {
  const alpha = snapshot.projects[0];
  alpha.panels[0].status = 'ready';
  alpha.panels.push({ id: 'idle', agent: 'pi' });
  alpha.tray.push({
    id: 'tray',
    agent: 'claude',
    status: 'busy',
    run: { id: 'tray-run', panelId: 'tray', projectId: 'alpha', state: 'running', title: 'Fix it' },
  });
}

export const panelOf = (request: DispatchRequest) =>
  request.target.kind === 'panel' ? request.target.panelId : 'new-panel';

export async function listed(
  dispatch: (
    projectId: string,
    request: DispatchRequest,
  ) => Promise<{ delivery: 'submit' | 'fill'; panelId: string }> = async (_, request) => ({
    delivery: 'submit',
    panelId: panelOf(request),
  }),
  change: (snapshot: Snapshot) => void = () => {},
) {
  const requests: [string, DispatchRequest][] = [];
  const f = renderWorkbench(githubCapabilities, {
    dispatch: async (projectId, request) => {
      requests.push([projectId, request]);
      return dispatch(projectId, request);
    },
    issueDetail: () => new Promise(() => {}),
    reportForgeRowResting: async () => {},
  });
  const first = await f.request(1);
  withPanels(f.snapshot);
  change(f.snapshot);
  f.publish();
  first.answer(page([issue(9), issue(8, { state: 'closed', closedAs: 'completed' })]));
  await waitFor(() => assert.ok(within(sidebar()).getAllByRole('listitem').length === 2));
  return { ...f, dispatches: requests };
}
export const row = (number: number) =>
  requireValue(
    within(sidebar())
      .getAllByRole('listitem')
      .find(item => within(item).queryByText(`#${number}`)),
    `the row of #${number}`,
  );
export const dispatchButton = (number: number) => within(row(number)).getByRole('button', { name: 'Dispatch' });
export const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
export const record = (
  issue: number,
  location: DispatchRecordView['location'],
  extra: Partial<DispatchRecordView> = {},
): DispatchRecordView => ({
  issueNumber: issue,
  dispatchedAt: hoursAgo(3),
  agent: 'codex',
  skill: 'implement',
  sessionId: `019a7c2e-${issue}000-7d1f-9b3e-5c6a2f8e4d10`,
  location,
  ...extra,
});
export const menu = (number = 9) => screen.getByRole('menu', { name: `Dispatch #${number}` });
export const issueDetail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({
  ...summary(number),
  url: `https://github.com/octo/alpha/issues/${number}`,
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
  links: {
    issuePrefix: 'https://github.com/octo/alpha/issues/',
    pullRequestPrefix: 'https://github.com/octo/alpha/pull/',
  },
  canWrite: true,
  ...extra,
});
