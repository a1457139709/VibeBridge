import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { localize } from '../../app/shared/localization/localization';
import {
  bug,
  failed,
  issue,
  openNoFilter,
  page,
  refresh,
  renderWorkbench,
  rows,
  sidebar,
  stubSidebarApis,
} from './support/forge-lists';

// The sidebar keeps each project's rows between views and updates them in the background
// (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md).

const { t } = localize('en');
const loadMore = () => within(sidebar()).getByRole('button', { name: t('loadMore') });

afterEach(cleanup);
before(stubSidebarApis);

test('search, state and labels are sent to the forge, each tab keeps its own, and switching back to a project shows its filter and kept rows while they update', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search issues' }), '#4');
  const searched = await request(2);
  assert.deepEqual(
    searched.query.filter,
    { search: '#4', state: 'open', labels: [] },
    'one request after typing settles',
  );
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
  assert.equal(
    (within(sidebar()).getByRole('searchbox', { name: 'Search pull requests' }) as HTMLInputElement).value,
    '',
    'the other tab has its own filter',
  );
  const pullRequests = await request(6);
  assert.deepEqual(pullRequests, {
    ...pullRequests,
    list: 'pullRequests',
    query: { filter: openNoFilter, cursor: null },
  });
  pullRequests.answer(page([]));
  await user.click(within(sidebar()).getByRole('tab', { name: 'Issues' }));
  const back = await request(7);
  assert.deepEqual(
    back.query.filter,
    { search: '#4', state: 'closed', labels: ['bug', 'docs'] },
    'the issues tab kept its filter and fetches again',
  );
  back.answer(page([]));

  await user.click(screen.getByRole('button', { name: 'Beta' }));
  const beta = await request(8);
  assert.deepEqual(beta, { ...beta, projectId: 'beta', query: { filter: openNoFilter, cursor: null } });
  beta.answer(page([issue(3)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 3']));
  await user.click(screen.getByRole('button', { name: 'Alpha' }));
  const alpha = await request(9);
  assert.deepEqual(
    alpha,
    {
      ...alpha,
      projectId: 'alpha',
      query: { filter: { search: '#4', state: 'closed', labels: ['bug', 'docs'] }, cursor: null },
    },
    'switching back updates the filter it showed',
  );
  assert.equal((within(sidebar()).getByRole('searchbox', { name: 'Search issues' }) as HTMLInputElement).value, '#4');
  assert.ok(within(sidebar()).getByText(t('noMatchingIssues')), 'its kept rows show while they update');
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  alpha.answer(page([issue(4)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 4']));
});

test('reopening the sidebar or bringing the window to the front shows the kept rows at once and updates them in place, with a stale notice when that fails', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(1)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.click(screen.getByRole('button', { name: t('closeForgeSidebar', { forge: 'GitHub' }) }));
  await user.click(screen.getByRole('button', { name: t('openForgeSidebar', { forge: 'GitHub' }) }));
  const reopened = await request(2);
  assert.deepEqual(reopened.query, { filter: openNoFilter, cursor: null });
  assert.deepEqual(rows(), ['Issue 1'], 'the kept rows show before the forge answers');
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  reopened.answer(page([issue(2), issue(1)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 2', 'Issue 1']));

  act(() => void window.dispatchEvent(new Event('blur')));
  act(() => void window.dispatchEvent(new Event('focus')));
  const inFront = await request(3);
  assert.deepEqual(inFront.query, { filter: openNoFilter, cursor: null });
  assert.equal(refresh().getAttribute('aria-busy'), 'true', 'the refresh icon spins while the update runs');
  assert.ok(loadMore().hasAttribute('disabled'), 'Load more waits for the update');
  inFront.answer(failed('transient', 'HTTP 502'));
  await waitFor(() => assert.ok(within(sidebar()).getByText(t('dataMayBeStale'))));
  assert.deepEqual(rows(), ['Issue 2', 'Issue 1'], 'the rows stay beside the notice');
  assert.ok(!loadMore().hasAttribute('disabled'), 'Load more is available again');
});
