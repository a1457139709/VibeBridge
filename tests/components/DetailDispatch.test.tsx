import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { IssueDetail } from '../../app/shared/forge/forge';
import type { DispatchRecordView } from '../../app/shared/dispatch';
import type { Snapshot } from '../../app/shared/model';
import { sidebar, stubSidebarApis } from './support/forge-lists';
import { issueDetail as detail, listed, record, row } from './support/dispatch';

afterEach(cleanup);
before(stubSidebarApis);

/** The Workbench with Alpha's issues listed and the detail of `issue` open; `change` sets up the snapshot. */
async function opened(issue: IssueDetail, change: (snapshot: Snapshot) => void = () => {}) {
  const f = await listed(undefined, change);
  window.workbench.issueDetail = async () => ({ ok: true, issue });
  await f.user.click(within(row(issue.number)).getByRole('button', { name: `Issue ${issue.number}` }));
  await within(pane()).findByRole('heading', { name: `Issue ${issue.number} #${issue.number}` });
  return f;
}
const pane = () => within(sidebar()).getByRole('region', { name: 'Issue detail' });
const records = () => within(pane()).getByRole('region', { name: /^Dispatch records/ });
/** The text sent of a record, while it shows. */
const sentText = (item: HTMLElement) => item.querySelector('code')?.textContent ?? null;
/** A record that is `hours` old. */
const aged = (hours: number, location: DispatchRecordView['location'], extra: Partial<DispatchRecordView> = {}) =>
  record(9, location, { dispatchedAt: new Date(Date.now() - hours * 3600e3).toISOString(), ...extra });

test('an open issue\'s detail has a Dispatch beside its state and labels that opens the same menu as its row', async () => {
  const f = await opened(detail(9));
  const head = pane().querySelector('.forge-doc-head')!;
  await f.user.click(within(head as HTMLElement).getByRole('button', { name: 'Dispatch' }));
  const menu = await waitFor(() => screen.getByRole('menu', { name: 'Dispatch #9' }));
  await waitFor(() => assert.equal(document.activeElement, menu));
  assert.equal(within(menu).getAllByRole('menuitem').length, 12);
  await f.user.hover(within(menu).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  await f.user.click(within(await waitFor(() => screen.getByRole('menu', { name: 'Targets for implement' }))).getByRole('menuitem', { name: /Fix it/ }));
  await waitFor(() => assert.deepEqual(f.dispatches, [['alpha', { issue: { number: 9, title: 'Issue 9' }, workflowId: 'matt', commandId: 'implement',
    target: { kind: 'panel', panelId: 'tray' }, invert: false }]]));
});

test('a closed issue\'s detail has no Dispatch', async () => {
  await opened(detail(8, { state: 'closed', closedAs: 'completed' }));
  assert.equal(within(pane()).queryByRole('button', { name: 'Dispatch' }), null);
});

test('Dispatch records list the issue\'s dispatches newest first: when, the Agent type, the session title that locates its panel, its status, and the text sent folded', async () => {
  const f = await opened(detail(9), snapshot => {
    snapshot.projects[0].dispatches = [
      aged(5, null, { agent: 'claude', text: '/to-spec 9' }),
      aged(2, { projectId: 'beta', panelId: 'beta-panel', status: 'ready', title: 'Beta session' }, { text: '$implement https://github.com/octo/alpha/issues/9' }),
      record(8, null),
    ];
  });
  const shown = within(records()).getAllByRole('listitem');
  assert.equal(within(records()).getByRole('button', { name: /Dispatch records/ }).textContent, '▾ Dispatch records (2)');
  assert.equal(shown.length, 2);
  assert.ok(within(shown[0]).getByText('2h ago'));
  assert.ok(within(shown[0]).getByRole('img', { name: 'Codex' }));
  assert.ok(within(shown[0]).getByRole('button', { name: 'Beta session' }), 'the session title is the link');
  assert.ok(within(shown[0]).getByRole('button', { name: 'Ready · Beta session' }), 'the status shows apart from the title');
  assert.ok(within(shown[1]).getByText('5h ago'));
  assert.ok(within(shown[1]).getByRole('img', { name: 'Claude Code' }));
  assert.ok(within(shown[1]).getByText('No panel is on this session'), 'a session no panel is on is named without a link');
  assert.equal(within(shown[1]).queryAllByRole('button').map(button => button.textContent).join(), '/to-spec ▸');

  assert.equal(sentText(shown[0]), null, 'the text sent starts folded');
  await f.user.click(within(shown[0]).getByRole('button', { name: '$implement ▸' }));
  await waitFor(() => assert.equal(sentText(shown[0]), '$implement https://github.com/octo/alpha/issues/9'));
  await f.user.click(within(shown[0]).getByRole('button', { name: 'Hide command' }));
  await waitFor(() => assert.equal(sentText(shown[0]), null));

  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  await f.user.click(within(shown[0]).getByRole('button', { name: 'Beta session' }));
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('an issue with no dispatches has no Dispatch records', async () => {
  await opened(detail(9));
  assert.equal(within(pane()).queryByRole('region', { name: /^Dispatch records/ }), null);
});

test('a closed issue\'s Dispatch records fold to their count and unfold on click', async () => {
  const f = await opened(detail(8, { state: 'closed', closedAs: 'completed' }), snapshot => {
    snapshot.projects[0].dispatches = [record(8, null), record(8, { projectId: 'alpha', panelId: 'tray', status: 'busy', title: 'Fix it' })];
  });
  const toggle = within(records()).getByRole('button', { name: /Dispatch records/ });
  assert.equal(toggle.textContent, '▸ Dispatch records (2)');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(within(records()).queryAllByRole('listitem'), []);
  await f.user.click(toggle);
  await waitFor(() => assert.equal(within(records()).getAllByRole('listitem').length, 2));
});

test('turning a workflow off leaves the records of its dispatches showing', async () => {
  await opened(detail(9), snapshot => {
    snapshot.settings.workflows.matt.enabled = false;
    snapshot.projects[0].dispatches = [record(9, null)];
  });
  assert.equal(within(records()).getAllByRole('listitem').length, 1);
});
