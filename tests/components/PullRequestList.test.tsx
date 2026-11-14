import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { stubLayoutApis } from './support/no-layout';
import { bug, failed, issue, pullRequest, openNoFilter, page, refresh, renderWorkbench, rows, sidebar } from './support/issue-list';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

/** The sidebar on the Pull requests tab, after the Issues tab has shown its first page. Returns the request count so far. */
async function onPullRequests() {
  const workbench = renderWorkbench();
  (await workbench.request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await workbench.user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  return workbench;
}

test('the Pull requests tab lists one page of rows with state, number, age, author, checks and labels, and Load more appends', async () => {
  const { user, request } = await onPullRequests();
  const first = await request(2);
  assert.deepEqual(first, { ...first, list: 'pullRequests', projectId: 'alpha', query: { filter: openNoFilter, cursor: null } });
  first.answer(page([
    pullRequest(9, { checks: 'passed', labels: [bug] }),
    pullRequest(8, { state: 'draft', checks: 'pending', author: 'octo' }),
    pullRequest(7, { checks: 'failed' }),
  ], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Change 9', 'Change 8', 'Change 7']));
  const [passed, pending, failing] = within(sidebar()).getAllByRole('listitem');
  assert.ok(within(passed).getByLabelText('Open pull request'), 'the state icon names the state');
  assert.ok(within(passed).getByText('#9'));
  assert.ok(within(passed).getByText('2d ago'));
  assert.ok(within(passed).getByText('mona'));
  assert.ok(within(passed).getByText('✓ Checks passed'));
  assert.ok(within(passed).getByText('bug'));
  assert.equal(passed.querySelector('.forge-row-action'), null, 'a pull request row has no action area');
  assert.ok(within(pending).getByLabelText('Draft pull request'));
  assert.ok(within(pending).getByText('octo'));
  assert.ok(within(pending).getByText('● Checks running'));
  assert.ok(within(failing).getByText('✗ Checks failed'));
  assert.ok(within(sidebar()).getByRole('button', { name: 'Open 7' }));
  assert.ok(within(sidebar()).getByRole('button', { name: 'Closed 2' }));

  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(3);
  assert.deepEqual(more, { ...more, list: 'pullRequests', query: { filter: openNoFilter, cursor: 'next' } });
  more.answer(page([pullRequest(6, { state: 'merged', checks: 'failed' }), pullRequest(5, { state: 'closed', author: null })]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 9', 'Change 8', 'Change 7', 'Change 6', 'Change 5']));
  const [merged, closed] = within(sidebar()).getAllByRole('listitem').slice(3);
  assert.ok(within(merged).getByLabelText('Merged pull request'));
  assert.equal(within(merged).queryByText(/Checks/), null, 'a merged pull request shows no checks');
  assert.ok(within(closed).getByLabelText('Closed pull request'));
  assert.equal(within(sidebar()).queryByRole('button', { name: 'Load more' }), null, 'the last page offers no more');
});

test('the Pull requests tab sends its own search, state and labels, and Refresh reloads its first page', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search pull requests' }), 'tray');
  const searched = await request(3);
  assert.deepEqual(searched, { ...searched, list: 'pullRequests', query: { filter: { search: 'tray', state: 'open', labels: [] }, cursor: null } });
  searched.answer(page([pullRequest(2)]));
  await user.click(within(sidebar()).getByRole('button', { name: 'Closed 2' }));
  const closed = await request(4);
  assert.deepEqual(closed.query.filter, { search: 'tray', state: 'closed', labels: [] });
  closed.answer(page([pullRequest(3, { state: 'merged' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 3']));
  await user.click(within(sidebar()).getByRole('button', { name: /^Labels/ }));
  await user.click(within(sidebar()).getByRole('menuitemcheckbox', { name: 'bug' }));
  const labelled = await request(5);
  assert.deepEqual(labelled.query.filter, { search: 'tray', state: 'closed', labels: ['bug'] });
  labelled.answer(page([]));
  await waitFor(() => assert.ok(within(sidebar()).getByText('No matching pull requests')));
  await user.click(refresh());
  const again = await request(6);
  assert.deepEqual(again, { ...again, list: 'pullRequests', query: { filter: { search: 'tray', state: 'closed', labels: ['bug'] }, cursor: null } });
  again.answer(page([pullRequest(4, { state: 'closed' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 4']));

  await user.click(within(sidebar()).getByRole('tab', { name: 'Issues' }));
  const issues = await request(7);
  assert.deepEqual(issues, { ...issues, list: 'issues', query: { filter: openNoFilter, cursor: null } }, 'the issues tab kept its own filter');
});

test('a pull request page failure keeps the rows under a stale notice, and fills the sidebar when there were none', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(failed('transient', 'HTTP 502: Bad Gateway'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Could not load pull requests: HTTP 502: Bad Gateway')));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  const retried = await request(3);
  assert.equal(retried.list, 'pullRequests');
  retried.answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
  await user.click(refresh());
  (await request(4)).answer(failed('transient', 'API rate limit exceeded'));
  const stale = await within(sidebar()).findByText('Data may be stale');
  assert.deepEqual(rows(), ['Change 1'], 'the old rows stay');
  await user.click(within(stale.parentElement!).getByRole('button', { name: 'Retry' }));
  (await request(5)).answer(page([pullRequest(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 2']));
  assert.equal(within(sidebar()).queryByText('Data may be stale'), null);
});

test('a logged-out forge CLI on the Pull requests tab fills the sidebar, and Retry reloads pull requests', async () => {
  const { user, request } = await onPullRequests();
  (await request(2)).answer(failed('loggedOut', 'HTTP 401: Bad credentials'));
  await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' });
  assert.equal(within(sidebar()).queryByRole('tab', { name: 'Pull requests' }), null, 'the state takes the whole content area');
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  const retried = await request(3);
  assert.equal(retried.list, 'pullRequests');
  retried.answer(page([pullRequest(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 1']));
});
