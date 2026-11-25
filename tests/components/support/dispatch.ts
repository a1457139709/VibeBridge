import assert from 'node:assert/strict';
import { screen, waitFor, within } from '@testing-library/react';
import type { DispatchRecordView, DispatchRequest } from '../../../app/shared/dispatch';
import type { IssueDetail } from '../../../app/shared/forge/forge';
import { issue, page, renderWorkbench, summary } from './forge-lists';
import { githubCapabilities } from './forge';
import { requireValue } from '../../../app/renderer/common/required';
import { agentNames, type AgentType, type Snapshot } from '../../../app/shared/model';
import type { ProcessingState } from '../../../app/shared/processing-status';
import type { Delivery } from '../../../app/shared/settings/workflows';
import { t } from './localization';
import { forgeSidebar } from './sidebar-queries';

export const trayTitle = 'Fix it',
  residentTitle = 'Alpha session';

export function withPanels(snapshot: Snapshot) {
  const alpha = snapshot.projects[0];
  alpha.panels[0].status = 'ready';
  alpha.panels.push({ id: 'idle', agent: 'pi' });
  alpha.tray.push({
    id: 'tray',
    agent: 'claude',
    status: 'busy',
    run: { id: 'tray-run', panelId: 'tray', projectId: 'alpha', state: 'running', title: trayTitle },
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
  await waitFor(() => assert.ok(within(forgeSidebar()).getAllByRole('listitem').length === 2));
  return { ...f, dispatches: requests };
}
export const row = (number: number) =>
  requireValue(
    within(forgeSidebar())
      .getAllByRole('listitem')
      .find(item => within(item).queryByRole('button', { name: summary(number).title })),
    `the row of #${number}`,
  );
export const issueButton = (number: number) => within(row(number)).getByRole('button', { name: summary(number).title });
export const dispatchButton = (number: number) => within(row(number)).getByRole('button', { name: t('dispatch') });
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
export const menu = (number = 9) => screen.getByRole('menu', { name: t('dispatchMenu', { number }) });
export const targetsMenu = (command: string) => screen.getByRole('menu', { name: t('dispatchTargets', { command }) });
const deliveryMessage = { submit: 'deliverySubmit', fill: 'deliveryFill' } as const;
export const commandNamed = (skill: string, deliveries: Delivery[] = ['submit', 'fill']) => ({
  name: (name: string) =>
    name.startsWith(skill) &&
    deliveries.some(delivery => name.slice(skill.length).trim() === t(deliveryMessage[delivery])),
});
export const newTargetName = (agent: AgentType) => t('dispatchNew', { agent: agentNames[agent] });
export const command = (skill: string, delivery: Delivery) => [skill, t(deliveryMessage[delivery])];
export const newTarget = (agent: AgentType) => [newTargetName(agent), t('ephemeralPanel')];
export const panelTarget = (agent: AgentType, status: ProcessingState, title: string, resident: boolean) => [
  agentNames[agent],
  t(status),
  title,
  t(status),
  t(resident ? 'residentPanel' : 'ephemeralPanel'),
];

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
