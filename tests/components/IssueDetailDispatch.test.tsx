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
import { defaultShortcuts } from '../../app/shared/shortcuts';

afterEach(cleanup);

const running = (id: string, title: string): PanelView =>
  ({ id, agent: 'claude', run: { id: `run-${id}`, panelId: id, projectId: 'app', state: 'running', title }, status: 'busy' });
const detail = (number: number, state: IssueDetail['state'] = 'open'): IssueDetail => ({ number, title: `Issue ${number}`, state,
  closedAs: state === 'closed' ? 'completed' : null, createdAt: '2026-11-01T00:00:00Z', labels: [{ name: 'bug', color: 'd73a4a' }],
  url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: [], blockedBy: [], author: 'mona', assignees: [], body: '<p>Body</p>',
  commentCount: 0, comments: [], blocking: [], closingMergeRequests: [], writable: false });
const located = (panelId: string, title: string): DispatchLocation =>
  ({ projectId: 'app', panelId, runId: `run-${panelId}`, ephemeral: false, status: 'busy', title });
const record = (issue: number, agent: DispatchRecordView['agent'], text: string, location: DispatchLocation | null, minutesAgo: number): DispatchRecordView =>
  ({ issue, time: new Date(Date.now() - minutesAgo * 60000).toISOString(), agent, text, location });

const project = (dispatches: DispatchRecordView[] = []): ProjectView => ({ id: 'app', name: 'App', directory: '/work/app', layout: null,
  repository: { platform: 'github', path: 'octo/app' }, panels: [running('resident', 'Fix the crash')], tray: [], dispatches });

/** Issue #7's detail in the App project, read as `shown`. */
async function renderDetail({ shown = detail(7), state = project(), workflows = defaultWorkflowSettings(), afterAction }:
  { shown?: IssueDetail; state?: ProjectView; workflows?: WorkflowSettings; /** What the platform shows once a direct action succeeds. */ afterAction?: IssueDetail } = {}) {
  const dispatched: DispatchRequest[] = [];
  const locations: DispatchLocation[] = [];
  const returns: number[] = [];
  const changes: string[] = [];
  const api = {
    issueDetail: async (): Promise<IssueDetailResult> => ({ ok: true, issue: shown }),
    dispatch: async (_projectId: string, request: DispatchRequest) => { dispatched.push(request); return null; },
    directAction: async () => {
      if (!afterAction) throw new Error('Unexpected direct action');
      shown = afterAction;
      return { ok: true as const };
    },
  };
  render(<Localization language="en">
    <IssueDetailView project={state} repository={state.repository!} number={shown.number} workflows={workflows} shortcuts={defaultShortcuts()}
      open={() => {}} close={() => {}} returnToList={() => returns.push(shown.number)} locate={location => locations.push(location)}
      host={{ changed() { changes.push('changed'); }, unavailable() {}, refreshes: 0 }} api={api} />
  </Localization>);
  await screen.findByRole('heading', { name: /Issue 7/ });
  return { user: userEvent.setup(), dispatched, locations, returns, changes, region: screen.getByRole('region', { name: 'Issue #7' }) };
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

test('a dispatch from the detail refreshes the sidebar list once', async () => {
  const { user, dispatched, changes, region } = await renderDetail();
  await user.click(within(region).getByRole('button', { name: 'Dispatch ▾' }));
  await user.click(within(screen.getByRole('menu', { name: 'Dispatch #7' })).getByRole('menuitem', { name: /^to-spec/ }));
  await user.click(screen.getByRole('menuitem', { name: /^Fix the crash/ }));
  await waitFor(() => assert.equal(dispatched.length, 1));
  await waitFor(() => assert.deepEqual(changes, ['changed']));
});

test('dispatch records shown while the issue is open fold to their count once it is closed', async () => {
  const { user } = await renderDetail({ shown: { ...detail(7), writable: true }, afterAction: { ...detail(7, 'closed'), writable: true },
    state: project([record(7, 'claude', '/tdd 7', null, 1)]) });
  assert.equal(screen.getByRole('button', { name: 'Dispatch records (1)' }).getAttribute('aria-expanded'), 'true');
  await user.click(screen.getByRole('button', { name: 'Close as completed' }));
  await screen.findByRole('button', { name: 'Reopen' });
  assert.equal(screen.getByRole('button', { name: 'Dispatch records (1)' }).getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('button', { name: 'Instruction' }), null);
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

test('within the detail the dispatch shortcut opens its menu and the locate shortcut locates its latest located dispatch', async () => {
  const records = [record(7, 'claude', '/tdd 7', null, 1), record(7, 'claude', '/tdd 7', located('resident', 'Fix the crash'), 5)];
  const { user, locations, region } = await renderDetail({ state: project(records) });
  within(region).getByRole('button', { name: 'Close detail' }).focus();
  await user.keyboard('{Meta>}d{/Meta}');
  assert.ok(within(region).getByRole('menu', { name: 'Dispatch #7' }).contains(document.activeElement), 'focus moves into the menu');
  await user.keyboard('{Escape}{Meta>}l{/Meta}');
  assert.deepEqual(locations.map(location => location.panelId), ['resident']);
});

test('an issue never dispatched has no dispatch records section', async () => {
  await renderDetail({ state: project([record(8, 'claude', '/tdd 8', null, 1)]) });
  assert.equal(screen.queryByRole('region', { name: /Dispatch records/ }), null);
});

test('arrow keys in the dispatch menu stay in the menu: they neither scroll the detail holding it nor return to the list', async context => {
  // jsdom has no layout to scroll; record what the detail asks to scroll instead.
  const scrolled: number[] = [];
  const prototype = window.HTMLElement.prototype;
  const scrollBy = prototype.scrollBy;
  prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (this.classList.contains('issue-detail-scroll') && typeof options === 'object') scrolled.push(options.top ?? 0);
  } as typeof scrollBy;
  context.after(() => { prototype.scrollBy = scrollBy; });
  const { user, region, returns } = await renderDetail();
  await user.click(within(region).getByRole('button', { name: 'Dispatch ▾' }));
  // → with no targets open does nothing in the menu, and must not leave the detail either.
  await user.keyboard('{ArrowDown}{ArrowUp}{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}{ArrowRight}');
  assert.ok(screen.getByRole('menu', { name: 'Dispatch #7' }), 'the menu stays open');
  assert.deepEqual(scrolled, []);
  assert.deepEqual(returns, []);

  await user.keyboard('{Escape}');
  assert.equal(screen.queryByRole('menu'), null);
  assert.deepEqual(returns, [], 'Escape closes the menu, not the detail');
  await user.keyboard('{ArrowDown}');
  assert.deepEqual(scrolled.map(Math.sign), [1], 'outside the menu the arrows scroll the detail again');
});
