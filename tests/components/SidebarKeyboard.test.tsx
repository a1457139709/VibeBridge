import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { issue, page, pullRequest, renderWorkbench, sidebar, stubSidebarApis, summary } from './support/forge-lists';
import { listed, record, row } from './support/dispatch';

afterEach(cleanup);
before(stubSidebarApis);

/** #10 has the open sub-issues #12 and #13; #12 is also on the page. */
const tree = () => page([
  issue(20),
  issue(12, { parent: 10 }),
  issue(10, { subIssues: { closed: 0, total: 2, issues: [summary(12), summary(13)] } }),
  issue(5),
]);
/** The list row title focus is on. */
const focusedRow = () => document.activeElement?.closest('.forge-row')?.querySelector('.forge-row-title')?.textContent;
const titleButton = (title: string) => within(sidebar()).getByRole('button', { name: title });

async function listedTree() {
  const f = renderWorkbench(undefined, { issueDetail: () => new Promise(() => {}) });
  (await f.request(1)).answer(tree());
  await waitFor(() => assert.ok(titleButton('Issue 20')));
  return f;
}

test('in the list ↑/↓ move between rows without wrapping, and Esc does nothing', async () => {
  const { user } = await listedTree();
  titleButton('Issue 20').focus();
  await user.keyboard('{ArrowUp}');
  assert.equal(focusedRow(), 'Issue 20', 'the first row stays');
  await user.keyboard('{ArrowDown}');
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowDown}{ArrowDown}');
  assert.equal(focusedRow(), 'Issue 5', 'the last row stays');
  await user.keyboard('{ArrowUp}');
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{Escape}');
  assert.equal(focusedRow(), 'Issue 10');
  assert.equal(document.querySelector('.forge-detail'), null);
});

test('in the list ← expands the sub-issues and then enters the first, → goes to the parent and then collapses it', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  assert.equal(within(sidebar()).getByRole('button', { name: 'Hide sub-issues' }).getAttribute('aria-expanded'), 'true');
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowLeft}');
  assert.equal(focusedRow(), 'Issue 12');
  await user.keyboard('{ArrowDown}');
  assert.equal(focusedRow(), 'Issue 13', 'expanded sub-issues are rows ↑/↓ move through');
  await user.keyboard('{ArrowLeft}');
  assert.equal(focusedRow(), 'Issue 13', 'an issue without sub-issues shown has none to enter');
  await user.keyboard('{ArrowRight}');
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowRight}');
  assert.equal(within(sidebar()).getByRole('button', { name: 'Show sub-issues' }).getAttribute('aria-expanded'), 'false');
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowRight}');
  assert.equal(focusedRow(), 'Issue 10', 'a top-level issue has no parent to go to');
});

/** The open detail, if any. */
const detail = () => document.querySelector<HTMLElement>('.forge-detail');

test('Space or Enter opens the row\'s detail with focus inside, and → or Esc return to the issue\'s list row', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard(' ');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement), 'focus moves into the detail'));
  assert.equal(document.activeElement, detail()!.querySelector('.forge-detail-scroll'), '↑/↓ scroll the body from there');
  await user.keyboard('{ArrowRight}');
  assert.equal(detail(), null);
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  within(detail()!).getByRole('button', { name: 'Close' }).focus();
  await user.keyboard('{Escape}');
  assert.equal(detail(), null);
  assert.equal(focusedRow(), 'Issue 5');
});

test('the pull request list moves with ↑/↓ and opens a detail that → returns from', async () => {
  const { user, request } = renderWorkbench(undefined, { pullRequestDetail: () => new Promise(() => {}) });
  (await request(1)).answer(page([]));
  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  (await request(2)).answer(page([pullRequest(31), pullRequest(30)]));
  (await waitFor(() => titleButton('Change 31'))).focus();
  await user.keyboard('{ArrowDown}{ArrowDown}');
  assert.equal(focusedRow(), 'Change 30');
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(detail()?.contains(document.activeElement)));
  await user.keyboard('{ArrowRight}');
  assert.equal(detail(), null);
  assert.equal(focusedRow(), 'Change 30');
});

test('opening the sidebar puts focus on the first row of its list once the list arrives', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(tree());
  await user.click(screen.getByRole('button', { name: 'Hide the GitHub sidebar' }));
  await user.click(screen.getByRole('button', { name: 'Show the GitHub sidebar' }));
  assert.ok(sidebar().contains(document.activeElement), 'focus goes into the sidebar at once');
  (await request(2)).answer(tree());
  await waitFor(() => assert.equal(focusedRow(), 'Issue 20'));
  await user.keyboard('{ArrowDown}');
  assert.equal(focusedRow(), 'Issue 10');
});

test('locating a panel from the sidebar on the settings page goes back to the workspace', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'alpha', panelId: 'alpha-panel', status: 'ready' })];
  });
  await f.user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  await f.user.click(within(row(9)).getByRole('button', { name: 'Ready · Untitled task' }));
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: '‹ Back' }), null));
});
