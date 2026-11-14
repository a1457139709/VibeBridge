import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { bug, failed, issue, openNoFilter, page, refresh, renderWorkbench, rows, sidebar, stubSidebarApis } from './support/forge-lists';

afterEach(cleanup);
before(stubSidebarApis);

test('the issue list shows one page of rows with their state, number, age and labels, and Load more appends the next page', async () => {
  const { user, request } = renderWorkbench();
  const first = await request(1);
  assert.deepEqual(first, { ...first, projectId: 'alpha', query: { filter: openNoFilter, cursor: null } });
  first.answer(page([issue(9, { labels: [bug] }), issue(8)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8']));
  const row = within(sidebar()).getAllByRole('listitem')[0];
  assert.ok(within(row).getByText('#9'));
  assert.ok(within(row).getByText('3h ago'));
  assert.ok(within(row).getByText('bug'));
  assert.ok(within(row).getByLabelText('Open issue'), 'the state icon names the state');
  assert.ok(row.querySelector('.forge-row-action'), 'the row keeps room for dispatch');
  assert.ok(within(sidebar()).getByRole('button', { name: 'Open 7' }));
  assert.ok(within(sidebar()).getByRole('button', { name: 'Closed 2' }));
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(2);
  assert.deepEqual(more.query, { filter: openNoFilter, cursor: 'next' });
  more.answer(page([issue(7, { state: 'closed', closedAs: 'notPlanned' })]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8', 'Issue 7']));
  assert.ok(within(sidebar()).getByLabelText('Closed as not planned'));
  assert.equal(within(sidebar()).queryByRole('button', { name: 'Load more' }), null, 'the last page offers no more');
});

test('Refresh is unavailable and shows progress while a request runs, and reloads the first page', async () => {
  const { user, request } = renderWorkbench();
  const first = await request(1);
  assert.ok(refresh().hasAttribute('disabled'));
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  first.answer(page([issue(1)], 'next'));
  await waitFor(() => assert.ok(!refresh().hasAttribute('disabled')));
  await user.click(refresh());
  const again = await request(2);
  assert.deepEqual(again.query, { filter: openNoFilter, cursor: null });
  assert.ok(refresh().hasAttribute('disabled'));
  again.answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2']));
});

test('search, state and labels are sent to the forge, each tab keeps its own, and switching project returns to open with no filter', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search issues' }), '#4');
  const searched = await request(2);
  assert.deepEqual(searched.query.filter, { search: '#4', state: 'open', labels: [] }, 'one request after typing settles');
  searched.answer(page([issue(4)]));
  await user.click(within(sidebar()).getByRole('button', { name: 'Closed 2' }));
  const closed = await request(3);
  assert.deepEqual(closed.query.filter, { search: '#4', state: 'closed', labels: [] });
  closed.answer(page([]));
  await user.click(within(sidebar()).getByRole('button', { name: /^Labels/ }));
  await user.click(within(sidebar()).getByRole('menuitemcheckbox', { name: 'bug' }));
  await user.click(within(sidebar()).getByRole('menuitemcheckbox', { name: 'docs' }));
  const labelled = await request(5);
  assert.deepEqual(labelled.query.filter, { search: '#4', state: 'closed', labels: ['bug', 'docs'] });
  labelled.answer(page([]));
  await waitFor(() => assert.ok(within(sidebar()).getByText('No matching issues')));

  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  assert.equal((within(sidebar()).getByRole('searchbox', { name: 'Search pull requests' }) as HTMLInputElement).value, '', 'the other tab has its own filter');
  const pullRequests = await request(6);
  assert.deepEqual(pullRequests, { ...pullRequests, list: 'pullRequests', query: { filter: openNoFilter, cursor: null } });
  pullRequests.answer(page([]));
  await user.click(within(sidebar()).getByRole('tab', { name: 'Issues' }));
  const back = await request(7);
  assert.deepEqual(back.query.filter, { search: '#4', state: 'closed', labels: ['bug', 'docs'] }, 'the issues tab kept its filter and fetches again');
  back.answer(page([]));

  await user.click(screen.getByRole('button', { name: 'Beta' }));
  const beta = await request(8);
  assert.deepEqual(beta, { ...beta, projectId: 'beta', query: { filter: openNoFilter, cursor: null } });
  beta.answer(page([issue(3)]));
  await user.click(screen.getByRole('button', { name: 'Alpha' }));
  const alpha = await request(9);
  assert.deepEqual(alpha, { ...alpha, projectId: 'alpha', query: { filter: openNoFilter, cursor: null } }, 'switching back refreshes from open with no filter');
  alpha.answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
});

test('reopening the sidebar refreshes the list', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(1)]));
  const toggle = screen.getByRole('button', { name: 'Hide the GitHub sidebar' });
  await user.click(toggle);
  await user.click(screen.getByRole('button', { name: 'Show the GitHub sidebar' }));
  (await request(2)).answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2']));
});

test('a missing forge CLI fills the sidebar with install instructions, and Retry refreshes', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('notInstalled'));
  const link = await within(sidebar()).findByRole('link', { name: 'Install instructions ↗' });
  assert.equal(link.getAttribute('href'), 'https://cli.github.com');
  assert.ok(within(sidebar()).getByText('Could not find gh. Install it to use the sidebar.'));
  assert.equal(within(sidebar()).queryByRole('tab', { name: 'Issues' }), null, 'the state takes the whole content area');
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
});

test('a logged-out forge CLI offers to copy the login command and Retry', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('loggedOut', 'HTTP 401: Bad credentials'));
  await user.click(await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' }));
  assert.equal(await navigator.clipboard.readText(), 'gh auth login');
  assert.ok(within(sidebar()).getByText('gh is not logged in, or its login expired.'));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  await request(2);
});

test('an inaccessible repository names the account and offers Retry and Change binding', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('inaccessible', 'GraphQL: Could not resolve to a Repository', 'octo'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Cannot access octo/alpha: it does not exist, or the gh account octo has no access to it.')));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(failed('inaccessible', 'GraphQL: Could not resolve to a Repository', null));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Cannot access octo/alpha: it does not exist, or the active gh account has no access to it.')));
  await user.click(within(sidebar()).getByRole('button', { name: 'Change binding' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
  await waitFor(() => assert.equal(document.activeElement?.textContent, 'Change', 'focus is on the repository field'));
  assert.ok(dialog.contains(document.activeElement));
});

test('a transient failure keeps the rows under a stale notice, and fills the sidebar when there were none', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(failed('transient', 'HTTP 502: Bad Gateway'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Could not load issues: HTTP 502: Bad Gateway')));
  assert.equal(within(sidebar()).queryByRole('tab', { name: 'Issues' }), null);
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.click(refresh());
  (await request(3)).answer(failed('transient', 'API rate limit exceeded'));
  const stale = await within(sidebar()).findByText('Data may be stale');
  assert.deepEqual(rows(), ['Issue 1'], 'the old rows stay');
  await user.click(within(stale.parentElement!).getByRole('button', { name: 'Retry' }));
  (await request(4)).answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2']));
  assert.equal(within(sidebar()).queryByText('Data may be stale'), null);
});

test('Load more pages the filter of the rows shown, even while a new search is still settling', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(9)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9']));
  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search issues' }), 'x');
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(2);
  assert.deepEqual(more.query, { filter: openNoFilter, cursor: 'next' });
  more.answer(page([issue(8)]));
  const searched = await request(3);
  assert.deepEqual(searched.query, { filter: { search: 'x', state: 'open', labels: [] }, cursor: null });
  searched.answer(page([issue(5)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 5']));
});

test('a request that fails outside the forge fills the sidebar with its reason and Retry', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).fail(new Error('No repository bound'));
  await waitFor(() => assert.ok(within(sidebar()).getByText('Could not load issues: No repository bound')));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(2)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
});
