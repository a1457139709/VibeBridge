import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { DispatchRecordView, DispatchRequest } from '../../app/shared/dispatch';
import type { Snapshot } from '../../app/shared/model';
import { issue, page, renderWorkbench, sidebar, stubSidebarApis } from './support/forge-lists';
import { githubCapabilities } from './support/forge';

afterEach(cleanup);
before(stubSidebarApis);

/** Alpha's resident panel runs Codex on "Alpha session"; its tray panel runs Claude Code, Busy on "Fix it"; a second
 * resident panel has no run. Beta's panel belongs to another project. */
function withPanels(snapshot: Snapshot) {
  const alpha = snapshot.projects[0];
  alpha.panels[0].status = 'ready';
  alpha.panels.push({ id: 'idle', agent: 'pi' });
  alpha.tray.push({ id: 'tray', agent: 'claude', status: 'busy', run: { id: 'tray-run', panelId: 'tray', projectId: 'alpha', state: 'running', title: 'Fix it' } });
}

/** The panel a dispatch goes to: the one it names, or a new one. */
const panelOf = (request: DispatchRequest) => request.target.kind === 'panel' ? request.target.panelId : 'new-panel';

/** The Workbench with Alpha's issues 9 and 8 listed; `dispatch` answers dispatches. */
async function listed(dispatch: (projectId: string, request: DispatchRequest) => Promise<{ delivery: 'submit' | 'fill'; panelId: string }> = async (_, request) => ({ delivery: 'submit', panelId: panelOf(request) }),
  change: (snapshot: Snapshot) => void = () => {}) {
  const requests: [string, DispatchRequest][] = [];
  const f = renderWorkbench(githubCapabilities, { dispatch: async (projectId, request) => { requests.push([projectId, request]); return dispatch(projectId, request); },
    // The detail is only opened, never answered.
    issueDetail: () => new Promise(() => {}) });
  const first = await f.request(1);
  // The app has subscribed once it asks for the list.
  withPanels(f.snapshot);
  change(f.snapshot);
  f.publish();
  first.answer(page([issue(9), issue(8, { state: 'closed', closedAs: 'completed' })]));
  await waitFor(() => assert.ok(within(sidebar()).getAllByRole('listitem').length === 2));
  return { ...f, dispatches: requests };
}
const row = (number: number) => within(sidebar()).getAllByRole('listitem').find(item => within(item).queryByText(`#${number}`))!;
const dispatchButton = (number: number) => within(row(number)).getByRole('button', { name: 'Dispatch' });

test('Dispatch opens the commands of the enabled workflow, each marked Submit or Fill only, without a workflow name', async () => {
  const f = await listed(undefined, snapshot => { snapshot.settings.workflows.matt.commands['to-spec'] = { delivery: 'fill' }; });
  assert.equal(within(row(8)).queryByRole('button', { name: 'Dispatch' }), null, 'a closed issue is not dispatched');
  await f.user.click(dispatchButton(9));
  const menu = screen.getByRole('menu', { name: 'Dispatch #9' });
  // Each command opens its targets leftwards, behind a caret.
  const commands = within(menu).getAllByRole('menuitem').map(item => item.textContent!.replace(/^‹/, ''));
  assert.deepEqual(commands.slice(0, 3), ['grill-with-docsSubmit', 'to-specFill only', 'to-ticketsSubmit']);
  assert.equal(commands.length, 12);
  assert.equal(within(menu).queryByText("Matt's workflow"), null);
});

test('with every workflow off the menu only says where to turn one on', async () => {
  const f = await listed(undefined, snapshot => { snapshot.settings.workflows.matt.enabled = false; });
  await f.user.click(dispatchButton(9));
  const menu = screen.getByRole('menu', { name: 'Dispatch #9' });
  assert.deepEqual(within(menu).queryAllByRole('menuitem'), []);
  assert.ok(within(menu).getByText('No workflow is enabled. Turn one on in Settings › Workflows'));
});

test('a command opens its targets: new panels of each Agent type, then the project\'s panels with a run', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(screen.getByRole('menu', { name: 'Dispatch #9' })).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  const targets = within(screen.getByRole('menu', { name: 'Targets for implement' })).getAllByRole('menuitem');
  assert.deepEqual(targets.map(target => target.textContent), ['✳New · Claude CodeEphemeral', 'New · CodexEphemeral', 'πNew · piEphemeral',
    'Alpha sessionReady · Resident', '✳Fix itBusy · Ephemeral']);
  assert.ok(within(targets[3]).getByRole('img', { name: 'Codex' }));
  assert.ok(within(targets[4]).getByRole('img', { name: 'Busy' }));
  await f.user.hover(targets[4]);
  assert.ok(screen.getByText('/implement …#9'), 'the preview shows the text the pointed target would receive');
});

test('submitting to a panel dispatches the issue, returns focus to Dispatch and refreshes the list once', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(screen.getByRole('menu', { name: 'Dispatch #9' })).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  await f.user.click(within(screen.getByRole('menu', { name: 'Targets for implement' })).getByRole('menuitem', { name: /Fix it/ }));
  await waitFor(() => assert.deepEqual(f.dispatches, [['alpha', { issue: { number: 9, title: 'Issue 9' }, workflowId: 'matt', commandId: 'implement',
    target: { kind: 'panel', panelId: 'tray' }, invert: false }]]));
  assert.equal(screen.queryByRole('menu'), null);
  await waitFor(() => assert.equal(document.activeElement, dispatchButton(9)));
  const again = await f.request(2);
  assert.deepEqual(again.query.cursor, null);
});

test('filling a panel closes the detail and keeps the sidebar open', async () => {
  const f = await listed(async (_, request) => ({ delivery: 'fill', panelId: panelOf(request) }));
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  await waitFor(() => assert.ok(document.querySelector('.forge-detail')));
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(screen.getByRole('menu', { name: 'Dispatch #9' })).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  await f.user.click(within(screen.getByRole('menu', { name: 'Targets for implement' })).getByRole('menuitem', { name: /Alpha session/ }));
  await waitFor(() => assert.equal(document.querySelector('.forge-detail'), null));
  assert.ok(sidebar());
});

test('submitting to a new panel dispatches to its Agent type and returns focus to Dispatch', async () => {
  const f = await listed();
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(screen.getByRole('menu', { name: 'Dispatch #9' })).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  const target = within(screen.getByRole('menu', { name: 'Targets for implement' })).getByRole('menuitem', { name: /New · Codex/ });
  await f.user.hover(target);
  assert.ok(screen.getByText('$implement …#9'), 'the preview shows the text in the new panel\'s Agent type');
  await f.user.click(target);
  await waitFor(() => assert.deepEqual(f.dispatches, [['alpha', { issue: { number: 9, title: 'Issue 9' }, workflowId: 'matt', commandId: 'implement',
    target: { kind: 'new', agent: 'codex' }, invert: false }]]));
  await waitFor(() => assert.equal(document.activeElement, dispatchButton(9)));
});

test('filling a new panel opens it as the temporary maximize once it joins the tray, closes the detail and keeps the sidebar open', async () => {
  const f = await listed(async () => ({ delivery: 'fill', panelId: 'new-panel' }));
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  await waitFor(() => assert.ok(document.querySelector('.forge-detail')));
  await f.user.click(dispatchButton(9));
  await f.user.hover(within(screen.getByRole('menu', { name: 'Dispatch #9' })).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  await f.user.click(within(screen.getByRole('menu', { name: 'Targets for implement' })).getByRole('menuitem', { name: /New · pi/ }));
  await waitFor(() => assert.deepEqual(f.dispatches.map(([, request]) => request.target), [{ kind: 'new', agent: 'pi' }]));
  // The dispatch can answer before the snapshot with the new panel reaches the renderer.
  f.snapshot.projects[0].tray.push({ id: 'new-panel', agent: 'pi', run: { id: 'new-run', panelId: 'new-panel', projectId: 'alpha', state: 'running', title: 'Fresh' } });
  f.publish();
  const card = await waitFor(() => within(screen.getByRole('region', { name: 'Ephemeral panel tray' })).getByRole('button', { name: /Fresh/ }));
  await waitFor(() => assert.equal(card.getAttribute('aria-pressed'), 'true'));
  await waitFor(() => assert.equal(document.querySelector('.forge-detail'), null));
  assert.ok(sidebar());
});

/** A record's time as the hint shows it. */
const when = (record: DispatchRecordView) => new Date(record.dispatchedAt).toLocaleString('en');
const record = (issue: number, location: DispatchRecordView['location'], extra: Partial<DispatchRecordView> = {}): DispatchRecordView =>
  ({ issue, dispatchedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), agent: 'codex', text: `/implement ${issue}`, location, ...extra });

test('an issue row shows its latest dispatch: the panel\'s state and session title with ×N, or grey when no panel is on its session', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [
      record(9, null), record(9, { projectId: 'alpha', panelId: 'tray', status: 'busy', title: 'Fix it' }, { text: '/implement 9 again' }),
      record(8, { projectId: 'alpha', panelId: 'tray', status: 'busy', title: 'Fix it' }),
    ];
  });
  const status = within(row(9)).getByRole('button', { name: 'Busy · Fix it' });
  assert.equal(status.textContent, 'Fix it ×2');
  assert.equal(status.getAttribute('data-hint'), `Busy · Codex · ${when(f.snapshot.projects[0].dispatches[1])} · /implement 9 again → Fix it (click to locate the panel)`);
  assert.equal(within(row(8)).queryByText('Fix it'), null, 'a closed issue shows no dispatch');
});

test('a dispatch whose session no panel is on shows grey with its age, and clicking a located one goes to its panel', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, null)];
  });
  assert.equal(within(row(9)).getByText(/^Dispatched ·/).textContent, 'Dispatched · 3h ago');
  f.snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' })];
  f.publish();
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  await f.user.click(await waitFor(() => within(row(9)).getByRole('button', { name: 'Ready · Untitled task' })));
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('a grey latest dispatch locates the latest earlier dispatch a panel is on, and its hint gives the record in full', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' }), record(9, null, { agent: 'claude' })];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  const status = await waitFor(() => within(row(9)).getByRole('button', { name: /^Dispatched ·/ }));
  assert.equal(status.getAttribute('data-hint'), `Claude Code · ${when(f.snapshot.projects[0].dispatches[1])} · /implement 9 → its session is not in any open panel (click to locate the latest dispatch a panel is on)`);
  await f.user.click(status);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});
