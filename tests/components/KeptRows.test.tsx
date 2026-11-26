import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import {
  bug,
  docs,
  failed,
  issue,
  openNoFilter,
  page,
  labelsFilter,
  refresh,
  renderWorkbench,
  rows,
  stateFilter,
  stubSidebarApis,
} from './support/forge-lists';
import { testForge } from './support/forge';
import { requireInstance } from './support/elements';
import { forgeSidebar, statusMessages } from './support/sidebar-queries';

const loadMore = () => within(forgeSidebar()).getByRole('button', { name: t('loadMore') });

afterEach(cleanup);
before(stubSidebarApis);

test('search, state and labels are sent to the forge, each tab keeps its own, and switching back to a project shows its filter and kept rows while they update', async () => {
  const { user, request, snapshot } = renderWorkbench();
  const [alpha, beta] = snapshot.projects;
  (await request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.type(within(forgeSidebar()).getByRole('searchbox', { name: t('searchIssues') }), '#4');
  const searched = await request(2);
  assert.deepEqual(
    searched.query.filter,
    { search: '#4', state: 'open', labels: [] },
    'one request after typing settles',
  );
  searched.answer(page([issue(4)]));
  await user.click(stateFilter('closed', 2));
  const closed = await request(3);
  assert.deepEqual(closed.query.filter, { search: '#4', state: 'closed', labels: [] });
  closed.answer(page([]));
  await user.click(labelsFilter());
  await user.click(within(forgeSidebar()).getByRole('menuitemcheckbox', { name: bug.name }));
  await user.click(within(forgeSidebar()).getByRole('menuitemcheckbox', { name: docs.name }));
  const labelled = await request(5);
  assert.deepEqual(labelled.query.filter, { search: '#4', state: 'closed', labels: ['bug', 'docs'] });
  labelled.answer(page([]));
  await waitFor(() => assert.ok(statusMessages().includes(t('noMatchingIssues'))));

  await user.click(within(forgeSidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  assert.equal(
    requireInstance(within(forgeSidebar()).getByRole('searchbox', { name: t('searchPullRequests') }), HTMLInputElement)
      .value,
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
  await user.click(within(forgeSidebar()).getByRole('tab', { name: t('issuesTab') }));
  const back = await request(7);
  assert.deepEqual(
    back.query.filter,
    { search: '#4', state: 'closed', labels: ['bug', 'docs'] },
    'the issues tab kept its filter and fetches again',
  );
  back.answer(page([]));

  await user.click(screen.getByRole('button', { name: beta.name }));
  const betaRequest = await request(8);
  assert.deepEqual(betaRequest, { ...betaRequest, projectId: 'beta', query: { filter: openNoFilter, cursor: null } });
  betaRequest.answer(page([issue(3)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 3']));
  await user.click(screen.getByRole('button', { name: alpha.name }));
  const alphaRequest = await request(9);
  assert.deepEqual(
    alphaRequest,
    {
      ...alphaRequest,
      projectId: 'alpha',
      query: { filter: { search: '#4', state: 'closed', labels: ['bug', 'docs'] }, cursor: null },
    },
    'switching back updates the filter it showed',
  );
  assert.equal(
    requireInstance(within(forgeSidebar()).getByRole('searchbox', { name: t('searchIssues') }), HTMLInputElement).value,
    '#4',
  );
  assert.ok(statusMessages().includes(t('noMatchingIssues')), 'its kept rows show while they update');
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  alphaRequest.answer(page([issue(4)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 4']));
});

test('reopening the sidebar or bringing the window to the front shows the kept rows at once and updates them in place, with a stale notice when that fails', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(1)], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 1']));
  await user.click(screen.getByRole('button', { name: t('closeForgeSidebar', { forge: testForge.name }) }));
  await user.click(screen.getByRole('button', { name: t('openForgeSidebar', { forge: testForge.name }) }));
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
  await waitFor(() => assert.ok(statusMessages().includes(t('dataMayBeStale'))));
  assert.deepEqual(rows(), ['Issue 2', 'Issue 1'], 'the rows stay beside the notice');
  assert.ok(!loadMore().hasAttribute('disabled'), 'Load more is available again');
});

test('switching back to a project shows the tab it was on', async () => {
  const { user, request, snapshot } = renderWorkbench();
  const [alpha, beta] = snapshot.projects;
  (await request(1)).answer(page([issue(1)]));
  await user.click(within(forgeSidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  (await request(2)).answer(page([]));
  await user.click(screen.getByRole('button', { name: beta.name }));
  const betaRequest = await request(3);
  assert.deepEqual(betaRequest, { ...betaRequest, projectId: 'beta', list: 'issues' });
  betaRequest.answer(page([issue(3)]));
  await user.click(screen.getByRole('button', { name: alpha.name }));
  const alphaRequest = await request(4);
  assert.deepEqual(alphaRequest, { ...alphaRequest, projectId: 'alpha', list: 'pullRequests' });
  assert.equal(
    within(forgeSidebar())
      .getByRole('tab', { name: t('pullRequestsTab') })
      .getAttribute('aria-selected'),
    'true',
  );
});
