import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { issue, page, pullRequest, renderWorkbench, stubSidebarApis, summary } from './support/forge-lists';
import { issueDetail, listed, record, row } from './support/dispatch';
import { selectElement, focusedElement } from './support/elements';
import { testForge } from './support/forge';
import { t } from './support/localization';
import { forgeSidebar, queryIssueDetail, queryPullRequestDetail } from './support/sidebar-queries';
import { requireValue } from '../../app/renderer/common/required';

afterEach(cleanup);
before(stubSidebarApis);

const parentWithTwoOpenSubIssues = () =>
  page([
    issue(20),
    issue(12, { parent: 10 }),
    issue(10, { subIssues: { closed: 0, total: 2, unlisted: 0, issues: [summary(12), summary(13)] } }),
    issue(5),
  ]);
const focusedRow = () => document.activeElement?.closest('.forge-row')?.querySelector('.forge-row-title')?.textContent;
const titleButton = (title: string) => within(forgeSidebar()).getByRole('button', { name: title });
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
  assert.equal(queryIssueDetail(), null);
});

test('in the list ← expands the sub-issues and then enters the first, → goes to the parent and then collapses it', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  await waitFor(() =>
    assert.equal(
      within(forgeSidebar())
        .getByRole('button', { name: t('hideSubIssues') })
        .getAttribute('aria-expanded'),
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
      within(forgeSidebar())
        .getByRole('button', { name: t('showSubIssues') })
        .getAttribute('aria-expanded'),
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

test("Space or Enter opens the row's detail with focus inside, and → or Esc return to the issue's list row", async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard(' ');
  await waitFor(() =>
    assert.equal(
      document.activeElement,
      queryIssueDetail()?.querySelector('.forge-detail-scroll'),
      'focus moves into the detail, where ↑/↓ scroll the body',
    ),
  );
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.equal(focusedRow(), 'Issue 10');
  await user.keyboard('{ArrowDown}{Enter}');
  await waitFor(() => assert.ok(queryIssueDetail()?.contains(document.activeElement)));
  within(requireValue(queryIssueDetail(), 'the issue detail'))
    .getByRole('button', { name: t('closeDetail') })
    .focus();
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.equal(focusedRow(), 'Issue 5');
});

test('Enter on the row of the one issue the detail shows closes the detail, and focus stays on that row', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(queryIssueDetail()?.contains(document.activeElement)));
  titleButton('Issue 10').focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.equal(focusedRow(), 'Issue 10');
});

test('closing a detail whose items have no list row showing puts focus on the list', async () => {
  const { user } = await listedTree();
  titleButton('Issue 10').focus();
  await user.keyboard('{ArrowLeft}');
  (await waitFor(() => titleButton('Issue 12'))).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(queryIssueDetail()?.contains(document.activeElement)));
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('hideSubIssues') }));
  await waitFor(() => assert.equal(within(forgeSidebar()).queryByRole('button', { name: issue(12).title }), null));
  selectElement('.forge-detail-scroll', requireValue(queryIssueDetail(), 'the issue detail')).focus();
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(queryIssueDetail(), null));
  assert.equal(
    document.activeElement,
    forgeSidebar().querySelector('.forge-scroll'),
    'focus stays in the sidebar, where the issue shortcuts are answered',
  );
});

test('the pull request list moves with ↑/↓ and opens a detail that → returns from', async () => {
  const { user, request } = renderWorkbench(undefined, { pullRequestDetail: () => new Promise(() => {}) });
  (await request(1)).answer(page([]));
  await user.click(within(forgeSidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  (await request(2)).answer(page([pullRequest(31), pullRequest(30)]));
  (await waitFor(() => titleButton('Change 31'))).focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Change 30'));
  await user.keyboard('{Enter}');
  await waitFor(() => assert.ok(queryPullRequestDetail()?.contains(document.activeElement)));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(queryPullRequestDetail(), null));
  assert.equal(focusedRow(), 'Change 30');
});

test('opening the sidebar puts focus on the first row of its list once the list arrives', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(parentWithTwoOpenSubIssues());
  await user.click(screen.getByRole('button', { name: t('closeForgeSidebar', { forge: testForge.name }) }));
  await user.click(screen.getByRole('button', { name: t('openForgeSidebar', { forge: testForge.name }) }));
  await waitFor(() =>
    assert.ok(forgeSidebar().contains(document.activeElement), 'focus goes into the sidebar at once'),
  );
  (await request(2)).answer(parentWithTwoOpenSubIssues());
  await waitFor(() => assert.equal(focusedRow(), 'Issue 20'));
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(focusedRow(), 'Issue 10'));
});

test("in an issue's detail Tab reaches its Dispatch and dispatch records, and Esc in its dispatch menu closes only the menu", async () => {
  const dispatched = record(9, { projectId: 'alpha', panelId: 'alpha-panel' });
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [dispatched];
  });
  f.forge.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  titleButton('Issue 9').focus();
  await f.user.keyboard('{Enter}');
  const pane = await waitFor(() => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') }));
  await waitFor(() =>
    assert.ok(within(pane).getByRole('heading', { level: 2 }).textContent?.startsWith(issueDetail(9).title)),
  );
  await waitFor(() => assert.ok(pane.contains(document.activeElement)));
  const headButton = within(selectElement('.forge-doc-head', pane)).getByRole('button', { name: t('dispatch') });
  const skillLinks = within(pane).getAllByRole('button', { name: dispatched.skill });
  const reached: Element[] = [];
  for (let step = 0; step < 12 && pane.contains(document.activeElement); step++) {
    await f.user.tab();
    reached.push(focusedElement());
  }
  assert.ok(reached.includes(headButton), 'Dispatch is reached');
  assert.ok(
    skillLinks.some(link => reached.includes(link)),
    "the record's skill link is reached",
  );
  await f.user.click(headButton);
  await waitFor(() => assert.ok(screen.getByRole('menu')));
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  assert.ok(queryIssueDetail(), 'the detail stays open');
});

test('locating a panel from the sidebar on the settings page goes back to the workspace', async () => {
  const dispatched = record(9, { projectId: 'alpha', panelId: 'alpha-panel' });
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [dispatched];
  });
  await f.user.click(screen.getByRole('button', { name: t('settings') }));
  await screen.findByRole('button', { name: t('back') });
  await f.user.click(within(row(9)).getByRole('button', { name: dispatched.skill }));
  await waitFor(() => assert.equal(screen.queryByRole('button', { name: t('back') }), null));
});
