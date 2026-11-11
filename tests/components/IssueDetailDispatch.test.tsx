import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IssueDetailView } from '../../app/renderer/IssueDetail';
import { Localization } from '../../app/renderer/Localization';
import type { PanelView, ProjectView } from '../../app/shared/model';
import type { DispatchLocation, DispatchRecordView, DispatchRequest } from '../../app/shared/dispatch';
import type { IssueDetail, IssueDetailResult } from '../../app/shared/code-hosting';
import { defaultWorkflowSettings, type WorkflowSettings } from '../../app/shared/workflows';

afterEach(cleanup);

const running = (id: string, title: string): PanelView =>
  ({ id, agent: 'claude', run: { id: `run-${id}`, panelId: id, projectId: 'app', state: 'running', title }, status: 'busy' });
const detail = (number: number, state: IssueDetail['state'] = 'open'): IssueDetail => ({ number, title: `Issue ${number}`, state,
  closedAs: state === 'closed' ? 'completed' : null, createdAt: '2026-11-01T00:00:00Z', labels: [{ name: 'bug', color: 'd73a4a' }],
  url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: [], blockedBy: [], author: 'mona', assignees: [], body: '<p>Body</p>',
  commentCount: 0, comments: [], blocking: [], closingMergeRequests: [] });
const located = (panelId: string, title: string): DispatchLocation =>
  ({ projectId: 'app', panelId, runId: `run-${panelId}`, ephemeral: false, status: 'busy', title });
const record = (issue: number, agent: DispatchRecordView['agent'], text: string, location: DispatchLocation | null, minutesAgo: number): DispatchRecordView =>
  ({ issue, time: new Date(Date.now() - minutesAgo * 60000).toISOString(), agent, text, location });

const project = (dispatches: DispatchRecordView[] = []): ProjectView => ({ id: 'app', name: 'App', directory: '/work/app', layout: null,
  repository: { platform: 'github', path: 'octo/app' }, panels: [running('resident', 'Fix the crash')], tray: [], dispatches });

/** Issue #7's detail in the App project, read as `shown`. */
async function renderDetail({ shown = detail(7), state = project(), workflows = defaultWorkflowSettings() }:
  { shown?: IssueDetail; state?: ProjectView; workflows?: WorkflowSettings } = {}) {
  const dispatched: DispatchRequest[] = [];
  const locations: DispatchLocation[] = [];
  const api = {
    issueDetail: async (): Promise<IssueDetailResult> => ({ ok: true, issue: shown }),
    dispatch: async (_projectId: string, request: DispatchRequest) => { dispatched.push(request); },
  };
  render(<Localization language="en">
    <IssueDetailView project={state} repository={state.repository!} number={shown.number} workflows={workflows}
      openIssue={() => {}} close={() => {}} returnToList={() => {}} locate={location => locations.push(location)} api={api} />
  </Localization>);
  await screen.findByRole('heading', { name: /Issue 7/ });
  return { user: userEvent.setup(), dispatched, locations, region: screen.getByRole('region', { name: 'Issue #7' }) };
}

test('the detail dispatches from a small button at the right of its state and labels row, through the same menu as a list row', async () => {
  const { user, dispatched, region } = await renderDetail();
  const button = within(region).getByRole('button', { name: 'Dispatch ▾' });
  const head = button.closest('.issue-detail-head')!;
  assert.ok(within(head as HTMLElement).getByText('bug'), 'the button shares the row with the labels');
  await user.click(button);
  await user.click(within(screen.getByRole('menu', { name: 'Dispatch #7' })).getByRole('menuitem', { name: /^to-spec/ }));
  await user.click(screen.getByRole('menuitem', { name: /^Fix the crash/ }));
  await waitFor(() => assert.deepEqual(dispatched, [{ issue: { number: 7, title: 'Issue 7' }, workflow: 'matt', instruction: 'to-spec', target: { panelId: 'resident' }, invert: false }]));
});

test('the dispatch records list every dispatch of the issue newest first, with its time, Agent type and session', async () => {
  const state = project([record(7, 'codex', '/tdd 7', located('resident', 'Fix the crash'), 2), record(8, 'pi', '/tdd 8', null, 5),
    record(7, 'claude', '/to-spec 7', null, 90)]);
  const { user, locations } = await renderDetail({ state });
  const records = screen.getByRole('region', { name: 'Dispatch records (2)' });
  const items = within(records).getAllByRole('listitem');
  assert.equal(items.length, 2);
  assert.ok(within(items[0]).getByText('2 minutes ago'));
  assert.ok(within(items[0]).getByText('Codex'));
  assert.ok(within(items[1]).getByText('2 hours ago'));
  assert.ok(within(items[1]).getByText('Claude Code'));
  assert.equal(within(items[1]).queryByRole('button', { name: /Locate/ }), null, 'a session no panel is on does not jump');
  assert.ok(within(items[1]).getByText('No panel is on this session'));
  await user.click(within(items[0]).getByRole('button', { name: 'Locate Fix the crash' }));
  assert.deepEqual(locations.map(location => location.panelId), ['resident']);
});

test('a dispatch record shows the instruction it sent only when unfolded', async () => {
  const { user } = await renderDetail({ state: project([record(7, 'claude', '/tdd https://github.com/octo/app/issues/7', null, 1)]) });
  const toggle = screen.getByRole('button', { name: 'Instruction' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByText('/tdd https://github.com/octo/app/issues/7'), null);
  await user.click(toggle);
  assert.ok(screen.getByText('/tdd https://github.com/octo/app/issues/7'));
});

test('a closed issue folds its dispatch records to their count, which unfold on request', async () => {
  const { user } = await renderDetail({ shown: detail(7, 'closed'), state: project([record(7, 'claude', '/tdd 7', null, 1), record(7, 'pi', '/tdd 7', null, 9)]) });
  const fold = screen.getByRole('button', { name: 'Dispatch records (2)' });
  assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('listitem'), null);
  await user.click(fold);
  assert.equal(within(screen.getByRole('region', { name: 'Dispatch records (2)' })).getAllByRole('listitem').length, 2);
});

test('switching every workflow off keeps the dispatch records shown', async () => {
  const workflows = defaultWorkflowSettings();
  workflows.matt.enabled = false;
  await renderDetail({ workflows, state: project([record(7, 'claude', '/tdd 7', located('resident', 'Fix the crash'), 1)]) });
  assert.equal(within(screen.getByRole('region', { name: 'Dispatch records (1)' })).getAllByRole('listitem').length, 1);
});

test('an issue never dispatched has no dispatch records section', async () => {
  await renderDetail({ state: project([record(8, 'claude', '/tdd 8', null, 1)]) });
  assert.equal(screen.queryByRole('region', { name: /Dispatch records/ }), null);
});
