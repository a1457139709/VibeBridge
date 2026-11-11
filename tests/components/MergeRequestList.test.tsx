import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import { platformDescriptions, type IssueFilter, type MergeRequestPage, type MergeRequestPageResult, type MergeRequestSummary, type PlatformFailureKind, type RepositoryChoices } from '../../app/shared/code-hosting';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  Object.assign(globalThis, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
});

const app: ProjectView = { id: 'app', name: 'App project', directory: '/work/app', layout: null, panels: [], tray: [],
  repository: { platform: 'github', path: 'octo/app' } };

const request = (number: number, extra: Partial<MergeRequestSummary> = {}): MergeRequestSummary => ({ number, title: `Change ${number}`, state: 'open',
  draft: false, author: 'mona', createdAt: '2026-11-01T00:00:00Z', checks: null, labels: [], url: `https://github.com/octo/app/pull/${number}`, ...extra });
const page = (mergeRequests: MergeRequestSummary[], next: string | null = null, labels: MergeRequestPage['labels'] = []): MergeRequestPageResult =>
  ({ ok: true, page: { mergeRequests, next, labels } });
const failure = (kind: PlatformFailureKind, output = ''): MergeRequestPageResult => ({ ok: false, failure: { kind, platform: platformDescriptions.github, output } });

interface Request { projectId: string; filter: IssueFilter; cursor: string | null; answer(result: MergeRequestPageResult): void }

/** The workbench with its issue sidebar open on the Pull requests tab; every merge request request waits for the test to answer it. */
async function renderPullRequests() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: true, width: 420 }, activeProjectId: app.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [app],
  };
  const requests: Request[] = [];
  let issueReads = 0;
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, ready: async () => {}, activateProject: async () => {},
    saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    issuePage: async () => { issueReads++; return { ok: true, page: { issues: [], next: null, labels: [] } }; },
    mergeRequestPage: (projectId, filter, cursor) => {
      const reply = deferred<MergeRequestPageResult>();
      requests.push({ projectId, filter, cursor, answer: reply.resolve });
      return reply.promise;
    } });
  render(<App />);
  const user = userEvent.setup();
  await waitFor(() => assert.equal(issueReads, 1));
  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  /** The next request after the `count` already seen. */
  const next = async (count: number) => { await waitFor(() => assert.ok(requests.length > count, `request ${count + 1}`)); return requests[count]; };
  return { user, requests, next, issueReads: () => issueReads };
}
const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const rows = () => within(sidebar()).queryAllByRole('listitem');
const names = () => rows().map(row => row.getAttribute('aria-label'));

test('the pull request list shows state, number, author, check conclusion and labels, with no actions', async () => {
  const { next, issueReads } = await renderPullRequests();
  const first = await next(0);
  assert.deepEqual([first.projectId, first.filter, first.cursor], ['app', { search: '', state: 'open', labels: [] }, null]);
  first.answer(page([
    request(4, { checks: 'passing', labels: [{ name: 'bug', color: 'd73a4a' }] }),
    request(3, { draft: true, checks: 'pending', author: 'hubot' }),
    request(2, { state: 'merged', checks: 'failing' }),
    request(1, { state: 'closed', author: null }),
  ]));
  await waitFor(() => assert.deepEqual(names(), ['#4 Change 4', '#3 Change 3', '#2 Change 2', '#1 Change 1']));
  const [open, draft, merged, closed] = rows();
  assert.ok(within(open).getByRole('img', { name: 'Open' }));
  assert.ok(within(draft).getByRole('img', { name: 'Draft' }));
  assert.ok(within(merged).getByRole('img', { name: 'Merged' }));
  assert.ok(within(closed).getByRole('img', { name: 'Closed' }));
  assert.ok(within(open).getByRole('img', { name: 'Checks passed' }));
  assert.ok(within(draft).getByRole('img', { name: 'Checks in progress' }));
  assert.ok(within(merged).getByRole('img', { name: 'Checks failed' }));
  assert.equal(within(closed).queryByRole('img', { name: /^Checks/ }), null, 'no checks, no conclusion');
  assert.ok(within(open).getByText('#4'));
  assert.ok(within(open).getByText('mona'));
  assert.ok(within(draft).getByText('hubot'));
  assert.ok(within(closed).getByText('ghost'), 'a deleted author reads as ghost, as on GitHub');
  assert.ok(within(open).getByRole('button', { name: 'Filter by label bug' }));
  assert.ok(within(open).getByRole('time'));
  for (const row of rows()) assert.equal(row.querySelector('.issue-row-actions'), null, 'a pull request row has no actions');
  assert.equal(issueReads(), 1, 'the pull request tab reads no issues');
});

test('pull requests load more with the cursor, filter on the platform and refresh on demand', async () => {
  const { user, next, requests } = await renderPullRequests();
  const labels = [{ name: 'bug', color: 'd73a4a' }];
  (await next(0)).answer(page([request(9, { labels })], 'cursor-2', labels));
  await waitFor(() => assert.deepEqual(names(), ['#9 Change 9']));
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await next(1);
  assert.equal(more.cursor, 'cursor-2');
  more.answer(page([request(8)], null, labels));
  await waitFor(() => assert.deepEqual(names(), ['#9 Change 9', '#8 Change 8']));

  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search pull requests' }), 'fix{Enter}');
  (await next(2)).answer(page([], null, labels));
  await user.click(within(sidebar()).getByRole('button', { name: 'Closed' }));
  (await next(3)).answer(page([request(7, { state: 'merged', labels })], null, labels));
  await waitFor(() => assert.deepEqual(names(), ['#7 Change 7']));
  await user.click(within(rows()[0]).getByRole('button', { name: 'Filter by label bug' }));
  (await next(4)).answer(page([], null, labels));
  assert.deepEqual(requests[4].filter, { search: 'fix', state: 'closed', labels: ['bug'] });
  await waitFor(() => assert.ok(within(sidebar()).getByText('No matching pull requests')));

  await user.click(within(sidebar()).getByRole('button', { name: 'Refresh' }));
  const again = await next(5);
  assert.deepEqual([again.filter, again.cursor], [{ search: 'fix', state: 'closed', labels: ['bug'] }, null]);
});

test('pull request failures show the issue list states: filling the sidebar, or keeping rows under a stale notice', async () => {
  const { user, next } = await renderPullRequests();
  (await next(0)).answer(failure('signedOut', 'gh auth login'));
  assert.ok(await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' }));
  assert.equal(within(sidebar()).queryByRole('searchbox'), null, 'the state fills the content area');
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await next(1)).answer(page([request(2)]));
  await waitFor(() => assert.deepEqual(names(), ['#2 Change 2']));

  await user.click(within(sidebar()).getByRole('button', { name: 'Refresh' }));
  (await next(2)).answer(failure('transient', 'HTTP 502'));
  assert.ok(await within(sidebar()).findByText('Data may be out of date'));
  assert.deepEqual(names(), ['#2 Change 2']);
});
