import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import {
  bug,
  failed,
  issue,
  labelsFilter,
  pullRequest,
  openNoFilter,
  page,
  refresh,
  renderWorkbench,
  rows,
  stateFilter,
  stubSidebarApis,
} from './support/forge-lists';
import { githubForge } from './support/forge';
import { t } from './support/localization';
import { selectElement } from './support/elements';
import { alertMessages, forgeSidebar, staleRetry, statusMessages } from './support/sidebar-queries';

afterEach(cleanup);
before(stubSidebarApis);

async function onPullRequests() {
  const workbench = renderWorkbench();
  (await workbench.request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await workbench.user.click(within(forgeSidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  return workbench;
}

test('the Pull requests tab lists one page of rows with state, number, age, author, checks and labels, and Load more appends', async () => {
  const { user, request } = await onPullRequests();
  const first = await request(2);
  assert.deepEqual(first, {
    ...first,
    list: 'pullRequests',
    projectId: 'alpha',
    query: { filter: openNoFilter, cursor: null },
  });
  first.answer(
    page(
      [
        pullRequest(9, { checks: 'passed', labels: [bug] }),
        pullRequest(8, { state: 'draft', checks: 'pending', author: 'octo' }),
        pullRequest(7, { checks: 'failed' }),
      ],
      'next',
    ),
  );
  await waitFor(() => assert.deepEqual(rows(), ['Change 9', 'Change 8', 'Change 7']));
  const [passed, pending, failing] = within(forgeSidebar()).getAllByRole('listitem');
  assert.ok(within(passed).getByRole('img', { name: t('pullRequestOpen') }), 'the state icon names the state');
  assert.equal(selectElement('.forge-row-number', passed).textContent, '#9');
  assert.equal(selectElement('time', passed).textContent, t('daysAgo', { count: 2 }));
  assert.equal(selectElement('.forge-author', passed).textContent, 'mona');
  assert.ok(within(passed).getByRole('img', { name: t('checksPassed') }));
  assert.ok(within(passed).getByRole('button', { name: bug.name }));
  assert.equal(passed.querySelector('.forge-row-action'), null, 'a pull request row has no action area');
  assert.ok(within(pending).getByRole('img', { name: t('pullRequestDraft') }));
  assert.equal(selectElement('.forge-author', pending).textContent, 'octo');
  assert.ok(within(pending).getByRole('img', { name: t('checksPending') }));
  assert.ok(within(failing).getByRole('img', { name: t('checksFailed') }));
  assert.ok(stateFilter('open', 7));
  assert.ok(stateFilter('closed', 2));

  await user.click(within(forgeSidebar()).getByRole('button', { name: t('loadMore') }));
  const more = await request(3);
  assert.deepEqual(more, { ...more, list: 'pullRequests', query: { filter: openNoFilter, cursor: 'next' } });
  more.answer(
    page([pullRequest(6, { state: 'merged', checks: 'failed' }), pullRequest(5, { state: 'closed', author: null })]),
  );
  await waitFor(() => assert.deepEqual(rows(), ['Change 9', 'Change 8', 'Change 7', 'Change 6', 'Change 5']));
  const [merged, closed] = within(forgeSidebar()).getAllByRole('listitem').slice(3);
  assert.ok(within(merged).getByRole('img', { name: t('pullRequestMerged') }));
  assert.equal(
    within(merged).queryByRole('img', { name: t('checksFailed') }),
    null,
    'a merged pull request shows no checks',
  );
  assert.ok(within(closed).getByRole('img', { name: t('pullRequestClosed') }));
  assert.equal(
    within(forgeSidebar()).queryByRole('button', { name: t('loadMore') }),
    null,
    'the last page offers no more',
  );
});

test('the Pull requests tab sends its own search, state and labels, and Refresh reloads its first page', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
  await user.type(within(forgeSidebar()).getByRole('searchbox', { name: t('searchPullRequests') }), 'tray');
  const searched = await request(3);
  assert.deepEqual(searched, {
    ...searched,
    list: 'pullRequests',
    query: { filter: { search: 'tray', state: 'open', labels: [] }, cursor: null },
  });
  searched.answer(page([pullRequest(2)]));
  await user.click(stateFilter('closed', 2));
  const closed = await request(4);
  assert.deepEqual(closed.query.filter, { search: 'tray', state: 'closed', labels: [] });
  closed.answer(page([pullRequest(3, { state: 'merged' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 3']));
  await user.click(labelsFilter());
  await user.click(within(forgeSidebar()).getByRole('menuitemcheckbox', { name: bug.name }));
  const labelled = await request(5);
  assert.deepEqual(labelled.query.filter, { search: 'tray', state: 'closed', labels: ['bug'] });
  labelled.answer(page([]));
  await waitFor(() => assert.ok(statusMessages().includes(t('noMatchingPullRequests'))));
  await user.click(refresh());
  const again = await request(6);
  assert.deepEqual(again, {
    ...again,
    list: 'pullRequests',
    query: { filter: { search: 'tray', state: 'closed', labels: ['bug'] }, cursor: null },
  });
  again.answer(page([pullRequest(4, { state: 'closed' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 4']));

  await user.click(within(forgeSidebar()).getByRole('tab', { name: t('issuesTab') }));
  const issues = await request(7);
  assert.deepEqual(
    issues,
    { ...issues, list: 'issues', query: { filter: openNoFilter, cursor: null } },
    'the issues tab kept its own filter',
  );
});

test('a pull request page failure keeps the rows under a stale notice, and fills the sidebar when there were none', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(failed('transient', 'HTTP 502: Bad Gateway'));
  await waitFor(() =>
    assert.ok(alertMessages().includes(t('pullRequestsLoadFailed', { reason: 'HTTP 502: Bad Gateway' }))),
  );
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('retry') }));
  const retried = await request(3);
  assert.equal(retried.list, 'pullRequests');
  retried.answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
  await user.click(refresh());
  (await request(4)).answer(failed('transient', 'API rate limit exceeded'));
  await waitFor(() => assert.ok(statusMessages().includes(t('dataMayBeStale'))));
  assert.deepEqual(rows(), ['Change 1'], 'the old rows stay');
  await user.click(staleRetry());
  (await request(5)).answer(page([pullRequest(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 2']));
  assert.ok(!statusMessages().includes(t('dataMayBeStale')));
});

test('a logged-out forge CLI on the Pull requests tab fills the sidebar, and Retry reloads pull requests', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(failed('loggedOut', 'HTTP 401: Bad credentials'));
  await within(forgeSidebar()).findByRole('button', { name: t('copyCommand', { command: githubForge.loginCommand }) });
  assert.equal(
    within(forgeSidebar()).queryByRole('tab', { name: t('pullRequestsTab') }),
    null,
    'the state takes the whole content area',
  );
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('retry') }));
  const retried = await request(3);
  assert.equal(retried.list, 'pullRequests');
  retried.answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
});
