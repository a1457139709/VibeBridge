import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { platformDescriptions, type IssueFilter, type IssuePage, type IssuePageResult, type IssueSummary, type MergeRequestPageResult, type PlatformFailureKind, type RepositoryChoices } from '../../app/shared/code-hosting';
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
const docs: ProjectView = { id: 'docs', name: 'Docs project', directory: '/work/docs', layout: null, panels: [], tray: [],
  repository: { platform: 'github', path: 'octo/docs' } };

const issue = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, ...extra });
const page = (issues: IssueSummary[], next: string | null = null, labels: IssuePage['labels'] = []): IssuePageResult => ({ ok: true, page: { issues, next, labels } });
const failure = (kind: PlatformFailureKind, output = '', account?: string): IssuePageResult =>
  ({ ok: false, failure: { kind, platform: platformDescriptions.github, output }, ...(account ? { account } : {}) });

interface Request { projectId: string; filter: IssueFilter; cursor: string | null; answer(result: IssuePageResult): void }

/** The workbench with its issue sidebar open on the App project; every list request waits for the test to answer it. */
function renderSidebar({ visible = true }: { visible?: boolean } = {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible, width: 420 }, activeProjectId: app.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [app, docs],
  };
  const requests: Request[] = [];
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    ready: async () => {}, activateProject: async id => {
      snapshot.activeProjectId = id;
      for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
    }, saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    mergeRequestPage: () => new Promise<MergeRequestPageResult>(() => {}),
    issuePage: (projectId, filter, cursor) => {
      const reply = deferred<IssuePageResult>();
      requests.push({ projectId, filter, cursor, answer: reply.resolve });
      return reply.promise;
    } });
  render(<App />);
  /** The next request after the `count` already seen. */
  const request = async (count: number) => { await waitFor(() => assert.ok(requests.length > count, `request ${count + 1}`)); return requests[count]; };
  return { user: userEvent.setup(), requests, request };
}
const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const rows = () => within(sidebar()).queryAllByRole('listitem').map(row => row.getAttribute('aria-label'));
const refresh = () => within(sidebar()).getByRole('button', { name: 'Refresh' }) as HTMLButtonElement;

test('the issue list shows a page of rows, loads more with the cursor and refreshes on demand', async () => {
  const { user, request } = renderSidebar();
  const first = await request(0);
  assert.deepEqual([first.projectId, first.filter, first.cursor], ['app', { search: '', state: 'open', labels: [] }, null]);
  assert.equal(refresh().disabled, true, 'refresh waits for the request in flight');
  first.answer(page([issue(9, { labels: [{ name: 'bug', color: 'd73a4a' }] }), issue(8, { state: 'closed', closedAs: 'completed' })], 'cursor-2'));
  await waitFor(() => assert.deepEqual(rows(), ['#9 Issue 9', '#8 Issue 8']));
  const row = within(sidebar()).getAllByRole('listitem')[0];
  assert.ok(within(row).getByText('bug'));
  assert.ok(within(row).getByRole('img', { name: 'Open' }));
  assert.ok(within(within(sidebar()).getAllByRole('listitem')[1]).getByRole('img', { name: 'Closed as completed' }));
  assert.ok(row.querySelector('.issue-row-actions'), 'the row keeps room for dispatch');
  assert.equal(refresh().disabled, false);
  assert.equal(within(sidebar()).queryByText(/updated/i), null);

  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  const more = await request(1);
  assert.equal(more.cursor, 'cursor-2');
  more.answer(page([issue(7)]));
  await waitFor(() => assert.deepEqual(rows(), ['#9 Issue 9', '#8 Issue 8', '#7 Issue 7']));
  assert.equal(within(sidebar()).queryByRole('button', { name: 'Load more' }), null);

  await user.click(refresh());
  const again = await request(2);
  assert.equal(again.cursor, null);
  again.answer(page([issue(10)]));
  await waitFor(() => assert.deepEqual(rows(), ['#10 Issue 10']));
});

test('search, state and every chosen label are sent to the platform, and each tab keeps its own filters', async () => {
  const { user, request, requests } = renderSidebar();
  const labels = [{ name: 'bug', color: 'd73a4a' }, { name: 'docs', color: '0075ca' }];
  (await request(0)).answer(page([issue(3, { labels: [labels[0]] })], null, labels));
  await waitFor(() => assert.deepEqual(rows(), ['#3 Issue 3']));

  await user.type(within(sidebar()).getByRole('searchbox', { name: 'Search issues' }), 'crash{Enter}');
  (await request(1)).answer(page([], null, labels));
  assert.equal(requests[1].filter.search, 'crash');
  await user.click(within(sidebar()).getByRole('button', { name: 'Closed' }));
  (await request(2)).answer(page([issue(3, { labels: [labels[0]] })], null, labels));
  assert.deepEqual(requests[2].filter, { search: 'crash', state: 'closed', labels: [] });
  await waitFor(() => assert.deepEqual(rows(), ['#3 Issue 3']));
  await user.click(within(within(sidebar()).getAllByRole('listitem')[0]).getByRole('button', { name: 'Filter by label bug' }));
  (await request(3)).answer(page([], null, labels));
  assert.deepEqual(requests[3].filter.labels, ['bug']);
  await user.click(within(sidebar()).getByRole('button', { name: 'Labels' }));
  await user.click(within(sidebar()).getByRole('menuitemcheckbox', { name: 'docs' }));
  (await request(4)).answer(page([], null, labels));
  assert.deepEqual(requests[4].filter, { search: 'crash', state: 'closed', labels: ['bug', 'docs'] });

  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  assert.equal(requests.length, 5, 'the pull request tab does not read issues');
  assert.equal((within(sidebar()).getByRole('searchbox', { name: 'Search pull requests' }) as HTMLInputElement).value, '');
  assert.equal(within(sidebar()).getByRole('button', { name: 'Open' }).getAttribute('aria-pressed'), 'true');
  await user.click(within(sidebar()).getByRole('tab', { name: 'Issues' }));
  const back = await request(5);
  assert.deepEqual(back.filter, { search: 'crash', state: 'closed', labels: ['bug', 'docs'] });
  assert.equal((within(sidebar()).getByRole('searchbox', { name: 'Search issues' }) as HTMLInputElement).value, 'crash');
});

test('switching projects reads the other repository from an open, unfiltered list, and switching back refreshes', async () => {
  const { user, request } = renderSidebar();
  (await request(0)).answer(page([issue(1)]));
  await user.click(within(sidebar()).getByRole('button', { name: 'Closed' }));
  (await request(1)).answer(page([]));
  await user.click(screen.getByRole('button', { name: 'Docs project' }));
  const other = await request(2);
  assert.deepEqual([other.projectId, other.filter], ['docs', { search: '', state: 'open', labels: [] }]);
  other.answer(page([]));
  await user.click(screen.getByRole('button', { name: 'App project' }));
  const returned = await request(3);
  assert.deepEqual([returned.projectId, returned.filter], ['app', { search: '', state: 'open', labels: [] }]);
});

test('opening the sidebar refreshes the list', async () => {
  const { user, request, requests } = renderSidebar({ visible: false });
  await screen.findByRole('button', { name: 'Open issue sidebar' });
  assert.equal(requests.length, 0);
  await user.click(screen.getByRole('button', { name: 'Open issue sidebar' }));
  (await request(0)).answer(page([issue(1)]));
  await user.click(screen.getByRole('button', { name: 'Close issue sidebar' }));
  await user.click(screen.getByRole('button', { name: 'Open issue sidebar' }));
  assert.equal((await request(1)).cursor, null);
});

test('a missing platform CLI fills the sidebar with where to install it', async () => {
  const { request } = renderSidebar();
  (await request(0)).answer(failure('notInstalled'));
  const link = await within(sidebar()).findByRole('link', { name: 'https://cli.github.com' });
  assert.equal(link.getAttribute('href'), 'https://cli.github.com');
  assert.ok(within(sidebar()).getByText('GitHub CLI is not installed.'));
  assert.equal(within(sidebar()).queryByRole('searchbox'), null, 'the state fills the content area');
});

test('a signed-out platform CLI offers to copy its sign-in command and retries on request', async () => {
  const { user, request } = renderSidebar();
  (await request(0)).answer(failure('signedOut', 'To get started with GitHub CLI, please run:  gh auth login'));
  await user.click(await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' }));
  assert.equal(await navigator.clipboard.readText(), 'gh auth login');
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(1)).answer(page([issue(1)]));
  await waitFor(() => assert.deepEqual(rows(), ['#1 Issue 1']));
});

test('an unreachable repository names the signed-in account and offers to retry or change the binding', async () => {
  const { user, request } = renderSidebar();
  (await request(0)).answer(failure('unreachable', 'Could not resolve to a Repository', 'octo'));
  assert.ok(await within(sidebar()).findByText('octo/app cannot be reached as octo. It may not exist, or this account may not have access.'));
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(1)).answer(failure('unreachable', '', 'octo'));
  await user.click(await within(sidebar()).findByRole('button', { name: 'Change binding' }));
  assert.ok(screen.getByRole('dialog', { name: 'Edit project' }));
});

test('a transient failure keeps the rows under a stale notice, or fills the sidebar when nothing was read yet', async () => {
  const { user, request } = renderSidebar();
  (await request(0)).answer(failure('transient', 'HTTP 502'));
  assert.ok(await within(sidebar()).findByText('Could not read from GitHub: HTTP 502'));
  assert.equal(within(sidebar()).queryByRole('searchbox'), null);
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(1)).answer(page([issue(2)]));
  await waitFor(() => assert.deepEqual(rows(), ['#2 Issue 2']));

  await user.click(refresh());
  (await request(2)).answer(failure('transient', 'API rate limit exceeded'));
  assert.ok(await within(sidebar()).findByText('Data may be out of date'));
  assert.deepEqual(rows(), ['#2 Issue 2']);
  await user.click(within(sidebar()).getByRole('button', { name: 'Retry' }));
  (await request(3)).answer(page([issue(4)]));
  await waitFor(() => assert.deepEqual(rows(), ['#4 Issue 4']));
  assert.equal(within(sidebar()).queryByText('Data may be out of date'), null);
});
