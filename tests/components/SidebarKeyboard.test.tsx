import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { issue, page, pullRequest, renderWorkbench, sidebar, stubSidebarApis, summary } from './support/forge-lists';
import { issueDetail, listed, record, row } from './support/dispatch';
import { selectElement, focusedElement } from './support/elements';

afterEach(cleanup);
before(stubSidebarApis);

const parentWithTwoOpenSubIssues = () =>
  page([
    issue(20),
    issue(12, { parent: 10 }),
    issue(10, { subIssues: { closed: 0, total: 2, issues: [summary(12), summary(13)] } }),
    issue(5),
  ]);
const focusedRow = () => document.activeElement?.closest('.forge-row')?.querySelector('.forge-row-title')?.textContent;
const titleButton = (title: string) => within(sidebar()).getByRole('button', { name: title });
const press = (key: string) => fireEvent.keyDown(focusedElement(), { key });

async function listedTree() {
  const f = renderWorkbench(undefined, { issueDetail: () => new Promise(() => {}) });
  (await f.request(1)).answer(parentWithTwoOpenSubIssues());
  await waitFor(() => assert.ok(titleButton('Issue 20')));
  return f;
}

test('in the list ↑/↓ move between rows', async () => {
  const { user } = await listedTree();
  titleButton('Issue 20').focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 10'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 5'));
  await user.keyboard('{ArrowUp}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 10'));
});

test('in the list ↑/↓ do not wrap at either end, and Esc on a row does nothing', async () => {
  await listedTree();
  titleButton('Issue 20').focus();
  press('ArrowUp');
  assert.equal(focusedRow(), 'Issue 20', 'the first row stays');
  titleButton('Issue 5').focus();
  press('ArrowDown');
  assert.equal(focusedRow(), 'Issue 5', 'the last row stays');
  assert.equal(press('Escape'), true, 'the key goes on');
  assert.equal(focusedRow(), 'Issue 5');
  assert.equal(document.querySelector('.forge-detail'), null);
});

test('in the list ← expands the sub-issues and then enters the first, → goes to the parent and then collapses it', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  await waitFor(() =>
    assert.equal(
      within(sidebar()).getByRole('button', { name: 'Hide sub-issues' }).getAttribute('aria-expanded'),
      'true',
    ),
  );
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowLeft}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 12'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 13', 'expanded sub-issues are rows ↑/↓ move through'));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 10'));
  await user.keyboard('{ArrowRight}');
  await waitFor(() =>
    assert.equal(
      within(sidebar()).getByRole('button', { name: 'Show sub-issues' }).getAttribute('aria-expanded'),
      'false',
    ),
  );
  assert.equal(focusedRow(), 'Issue 10');
});

test('in the list ← on an issue with no sub-issues shown and → on a top-level issue leave focus where it is', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  (await waitFor(() => titleButton('Issue 13'))).focus();
  press('ArrowLeft');
  assert.equal(focusedRow(), 'Issue 13', 'an issue without sub-issues shown has none to enter');
  titleButton('Issue 20').focus();
  press('ArrowRight');
  assert.equal(focusedRow(), 'Issue 20', 'a top-level issue has no parent to go to');
});

const detail = () => document.querySelector<HTMLElement>('.forge-detail');

test("Space or Enter opens the row's detail with focus inside, and → or Esc return to the issue's list row", async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard(' ');
  await waitFor(() =>
    assert.equal(
      document.activeElement,
      detail()?.querySelector('.forge-detail-scroll'),
      'focus moves into the detail, where ↑/↓ scroll the body',
    ),
  );
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(detail(), null));
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  within(selectElement('.forge-detail')).getByRole('button', { name: 'Close' }).focus();
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(detail(), null));
  assert.equal(focusedRow(), 'Issue 5');
});

test('Enter on the row of the one issue the detail shows closes the detail, and focus stays on that row', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  titleButton('Issue 10').focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.equal(detail(), null));
  assert.equal(focusedRow(), 'Issue 10');
});

test('closing a detail whose items have no list row showing puts focus on the list', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  (await waitFor(() => titleButton('Issue 12'))).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  await user.click(within(sidebar()).getByRole('button', { name: 'Hide sub-issues' }));
  await waitFor(() => assert.equal(within(sidebar()).queryByRole('button', { name: 'Issue 12' }), null));
  selectElement('.forge-detail-scroll', selectElement('.forge-detail')).focus();
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(detail(), null));
  assert.equal(
    document.activeElement,
    sidebar().querySelector('.forge-scroll'),
    'focus stays in the sidebar, where the issue shortcuts are answered',
  );
});

test('the pull request list moves with ↑/↓ and opens a detail that → returns from', async () => {
  const { user, request } = renderWorkbench(undefined, { pullRequestDetail: () => new Promise(() => {}) });
  (await request(1)).answer(page([]));
  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  (await request(2)).answer(page([pullRequest(31), pullRequest(30)]));
  (await waitFor(() => titleButton('Change 31'))).focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Change 30'));
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(detail(), null));
  assert.equal(focusedRow(), 'Change 30');
});

test('opening the sidebar puts focus on the first row of its list once the list arrives', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(parentWithTwoOpenSubIssues());
  await user.click(screen.getByRole('button', { name: 'Hide the GitHub sidebar' }));
  await user.click(screen.getByRole('button', { name: 'Show the GitHub sidebar' }));
  await waitFor(() => assert.ok(sidebar().contains(document.activeElement), 'focus goes into the sidebar at once'));
  (await request(2)).answer(parentWithTwoOpenSubIssues());
  await waitFor(() => assert.equal(focusedRow(), 'Issue 20'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 10'));
});

test("in an issue's detail Tab reaches its Dispatch and dispatch records, and Esc in its dispatch menu closes only the menu", async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'alpha', panelId: 'alpha-panel' })];
  });
  f.forge.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  titleButton('Issue 9').focus();
  await f.user.keyboard('{Enter}');
  const pane = await waitFor(() => within(sidebar()).getByRole('region', { name: 'Issue detail' }));
  await within(pane).findByRole('heading', { name: 'Issue 9 #9' });
  await waitFor(() => assert.ok(pane.contains(document.activeElement)));
  const reached: string[] = [];
  for (let step = 0; step < 12 && pane.contains(document.activeElement); step++) {
    await f.user.tab();
    reached.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
  }
  assert.ok(reached.includes('Dispatch ▾'), `Dispatch is reached: ${reached.join(' | ')}`);
  assert.ok(reached.includes('implement'), `the record's skill link is reached: ${reached.join(' | ')}`);
  await f.user.click(within(selectElement('.forge-doc-head', pane)).getByRole('button', { name: 'Dispatch' }));
  await waitFor(() => assert.ok(screen.getByRole('menu')));
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  assert.ok(detail(), 'the detail stays open');
});

test('locating a panel from the sidebar on the settings page goes back to the workspace', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'alpha', panelId: 'alpha-panel' })];
  });
  await f.user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  await f.user.click(within(row(9)).getByRole('button', { name: 'implement' }));
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: '‹ Back' }), null));
});
