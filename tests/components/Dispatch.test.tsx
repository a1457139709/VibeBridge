import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IssueLists } from '../../app/renderer/IssueLists';
import { Localization } from '../../app/renderer/Localization';
import type { PanelCreation, PanelView, ProjectView } from '../../app/shared/model';
import type { DispatchLocation, DispatchRecordView, DispatchRequest } from '../../app/shared/dispatch';
import type { IssuePageResult, IssueSummary } from '../../app/shared/code-hosting';
import { defaultWorkflowSettings, type WorkflowSettings } from '../../app/shared/workflows';
import { defaultShortcuts } from '../../app/shared/shortcuts';

afterEach(cleanup);

const running = (id: string, agent: PanelView['agent'], title?: string, status: PanelView['status'] = 'ready'): PanelView =>
  ({ id, agent, run: { id: `run-${id}`, panelId: id, projectId: 'app', state: 'running', ...(title ? { title } : {}) }, status });
const issue = (number: number, state: IssueSummary['state'] = 'open'): IssueSummary => ({ number, title: `Issue ${number}`, state,
  closedAs: state === 'closed' ? 'completed' : null, createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [] });
const located = (panelId: string, extra: Partial<DispatchLocation> = {}): DispatchLocation =>
  ({ projectId: 'app', panelId, runId: `run-${panelId}`, ephemeral: false, status: 'busy', title: 'Fix the crash', ...extra });
const record = (issue: number, location: DispatchLocation | null, minutesAgo = 5): DispatchRecordView =>
  ({ issue, time: new Date(Date.now() - minutesAgo * 60000).toISOString(), agent: 'claude', text: `/tdd https://github.com/octo/app/issues/${issue}`, location });

function project(extra: Partial<ProjectView> = {}): ProjectView {
  return { id: 'app', name: 'App', directory: '/work/app', layout: null, repository: { platform: 'github', path: 'octo/app' },
    panels: [running('resident', 'claude', 'Fix the crash', 'busy'), { id: 'idle', agent: 'pi' }],
    tray: [running('ephemeral', 'codex')], dispatches: [], ...extra };
}

/** The issue list of the App project, answering every page request with these issues. */
function renderList({ state = project(), workflows = defaultWorkflowSettings(), issues = [issue(7)], creation = null }:
  { state?: ProjectView; workflows?: WorkflowSettings; issues?: IssueSummary[]; creation?: PanelCreation | null } = {}) {
  const dispatched: DispatchRequest[] = [];
  const locations: DispatchLocation[] = [], fills: DispatchLocation[] = [];
  let reads = 0;
  const api = {
    issuePage: async (): Promise<IssuePageResult> => { reads++; return { ok: true, page: { issues, next: null, labels: [] } }; },
    mergeRequestPage: () => new Promise<never>(() => {}),
    dispatch: async (_projectId: string, request: DispatchRequest) => { dispatched.push(request); return creation; },
  };
  const view = (next: ProjectView) => <Localization language="en">
    <IssueLists project={next} repository={next.repository!} workflows={workflows} shortcuts={defaultShortcuts()} changeBinding={() => {}} locate={location => locations.push(location)} filled={location => fills.push(location)} detail={{ open() {} }} api={api} />
  </Localization>;
  const result = render(view(state));
  return { user: userEvent.setup(), dispatched, locations, fills, reads: () => reads, rerender: (next: ProjectView) => result.rerender(view(next)) };
}
const row = async (number: number) => screen.findByRole('listitem', { name: `#${number} Issue ${number}` });
const openMenu = async (user: ReturnType<typeof userEvent.setup>, number = 7) => {
  await user.click(within(await row(number)).getByRole('button', { name: 'Dispatch ▾' }));
  return screen.getByRole('menu', { name: `Dispatch #${number}` });
};

test('the dispatch menu opens on its instructions, each with its delivery, and with no default', async () => {
  const workflows = defaultWorkflowSettings();
  workflows.matt.instructions.triage.delivery = 'fill';
  const { user, dispatched } = renderList({ workflows });
  const menu = await openMenu(user);
  const items = within(menu).getAllByRole('menuitem');
  assert.equal(items.length, 12);
  assert.equal(items[0].textContent, 'grill-with-docsSubmit');
  assert.equal(within(menu).getByRole('menuitem', { name: /^triage/ }).textContent, 'triageFill only');
  assert.equal(within(menu).queryByRole('group'), null, 'one enabled workflow shows no workflow name');
  assert.equal(screen.queryByRole('menu', { name: /to-spec/ }), null, 'no instruction is chosen until the user picks one');
  assert.deepEqual(dispatched, []);
});

test('with every workflow off the menu explains where to enable one', async () => {
  const workflows = defaultWorkflowSettings();
  workflows.matt.enabled = false;
  const { user } = renderList({ workflows });
  const menu = await openMenu(user);
  assert.deepEqual(within(menu).queryAllByRole('menuitem'), []);
  assert.ok(within(menu).getByText('No workflows are enabled. Enable one in Settings › Workflows.'));
});

test('an instruction\'s targets are new panels of each Agent type, then every panel of the project with a running Agent, whatever its state', async () => {
  const { user } = renderList();
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^to-spec/ }));
  const targets = within(screen.getByRole('menu', { name: 'Dispatch to-spec to' })).getAllByRole('menuitem');
  assert.deepEqual(targets.map(target => target.getAttribute('aria-label')), [
    'New · Claude Code', 'New · Codex', 'New · pi',
    'Fix the crash · Busy · Claude Code · Resident', 'Untitled task · Ready · Codex · Ephemeral',
  ]);
  assert.equal(targets[3].hasAttribute('aria-disabled'), false, 'a busy panel is not greyed out');
});

test('submitting to a panel sends the dispatch, closes the menu, returns focus to the dispatch button and refreshes the list once', async () => {
  const { user, dispatched, locations, reads } = renderList();
  await waitFor(() => assert.equal(reads(), 1));
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^to-spec/ }));
  await user.click(screen.getByRole('menuitem', { name: /^Fix the crash/ }));
  assert.deepEqual(dispatched, [{ issue: { number: 7, title: 'Issue 7' }, workflow: 'matt', instruction: 'to-spec', target: { panelId: 'resident' }, invert: false }]);
  await waitFor(() => assert.equal(reads(), 2));
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(document.activeElement, within(await row(7)).getByRole('button', { name: 'Dispatch ▾' }));
  assert.deepEqual(locations, []);
});

test('filling a panel shows it as filled', async () => {
  const workflows = defaultWorkflowSettings();
  workflows.matt.instructions.tdd.delivery = 'fill';
  const { user, fills } = renderList({ workflows });
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^tdd/ }));
  await user.click(screen.getByRole('menuitem', { name: /Ephemeral$/ }));
  await waitFor(() => assert.deepEqual(fills.map(location => location.panelId), ['ephemeral']));
  assert.equal(screen.queryByRole('menu'), null);
});

const created = (outcome: 'started' | 'failed' = 'started'): PanelCreation =>
  ({ panel: { id: 'new', agent: 'codex' }, launch: { outcome, agent: 'codex', run: { id: 'run-new', panelId: 'new', projectId: 'app', state: outcome === 'started' ? 'running' : 'failed' } } });

test('submitting to a new panel leaves it in the tray and returns focus to the dispatch button', async () => {
  const { user, dispatched, locations, fills } = renderList({ creation: created() });
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^to-spec/ }));
  await user.click(screen.getByRole('menuitem', { name: 'New · Codex' }));
  assert.deepEqual(dispatched.map(request => request.target), [{ agent: 'codex' }]);
  await waitFor(() => assert.equal(document.activeElement, within(screen.getByRole('listitem', { name: '#7 Issue 7' })).getByRole('button', { name: 'Dispatch ▾' })));
  assert.equal(screen.queryByRole('menu'), null);
  assert.deepEqual([...locations, ...fills], []);
});

test('filling a new panel opens it once the snapshot shows it in the tray', async () => {
  const workflows = defaultWorkflowSettings();
  workflows.matt.instructions.tdd.delivery = 'fill';
  const { user, dispatched, fills, rerender } = renderList({ workflows, creation: created() });
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^tdd/ }));
  await user.click(screen.getByRole('menuitem', { name: 'New · Codex' }));
  await waitFor(() => assert.equal(dispatched.length, 1));
  rerender(project({ tray: [running('ephemeral', 'codex'), running('new', 'codex')] }));
  await waitFor(() => assert.deepEqual(fills, [{ projectId: 'app', panelId: 'new', runId: 'run-new', ephemeral: true }]));
});

test('a new panel whose Agent could not start shows why', async () => {
  const { user, fills } = renderList({ creation: created('failed') });
  await user.click(within(await openMenu(user)).getByRole('menuitem', { name: /^to-spec/ }));
  await user.click(screen.getByRole('menuitem', { name: 'New · Claude Code' }));
  assert.equal((await screen.findByRole('alert')).textContent, 'Agent could not start');
  assert.deepEqual(fills, []);
});

test('an issue row shows its latest dispatch: the panel on its session, or a grey dispatched time, and nothing once closed', async () => {
  const state = project({ dispatches: [record(7, located('resident'), 1), record(7, null, 30), record(8, null, 120)] });
  const { rerender } = renderList({ state, issues: [issue(7), issue(8), issue(9, 'closed')] });
  const latest = within(await row(7)).getByRole('button', { name: /^Locate the panel of the latest dispatch/ });
  assert.ok(within(latest).getByRole('img', { name: 'Busy' }));
  assert.equal(within(latest).getByText('Fix the crash').className, 'issue-dispatch-title');
  assert.ok(within(latest).getByText('×2'));
  assert.match(latest.getAttribute('data-hint')!, /Fix the crash · Claude Code · .+: \/tdd https:\/\/github.com\/octo\/app\/issues\/7/);
  assert.ok(within(await row(8)).getByText('Dispatched · 2 hours ago'));
  assert.equal(within(await row(9)).queryByText(/Dispatched/), null);

  rerender(project({ dispatches: [record(7, null, 1), record(7, null, 30)] }));
  assert.ok(within(await row(7)).getByText('Dispatched · 1 minute ago'), 'the record view follows the snapshot');
});

test('clicking the dispatch status locates the latest dispatch whose session a panel is on, or does nothing', async () => {
  const state = project({ dispatches: [record(7, null, 1), record(7, located('ephemeral', { ephemeral: true }), 10), record(7, located('resident'), 20), record(8, null)] });
  const { user, locations } = renderList({ state, issues: [issue(7), issue(8)] });
  await user.click(within(await row(7)).getByRole('button', { name: /^Locate/ }));
  assert.deepEqual(locations.map(location => location.panelId), ['ephemeral']);
  await user.click(within(await row(8)).getByRole('button', { name: /^Locate/ }));
  assert.equal(locations.length, 1);
});
