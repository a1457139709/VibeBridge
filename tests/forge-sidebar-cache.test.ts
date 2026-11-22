import test from 'node:test';
import assert from 'node:assert/strict';
import type { ForgeSidebarPresence } from '../app/shared/forge/sidebar-data';
import { openNoFilter } from './support/bound-workbench';
import { lastOf } from './support/expected';
import {
  byNumber,
  detail,
  detailTitle,
  forge,
  issue,
  numbers,
  page,
  shownIssues,
  sidebarData,
} from './support/sidebar-data-sources';

test('nothing updates while the sidebar is hidden or its window is behind; showing it, returning to the project or bringing the window to the front updates the shown tab', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [1]);
  await data.reportPresence({ visible: false, foreground: true, projectId: 'alpha' });
  await data.reportPresence({ visible: true, foreground: false, projectId: 'alpha' });
  await data.reportPresence({ visible: false, foreground: false, projectId: 'alpha' });
  assert.equal(reads.length, 1, 'no update while hidden or behind');
  const shownAlpha: ForgeSidebarPresence = { visible: true, foreground: true, projectId: 'alpha' };
  const steps: [trigger: string, before: () => Promise<unknown>][] = [
    ['the sidebar shows', async () => {}],
    ['the window is back in front', () => data.reportPresence({ ...shownAlpha, foreground: false })],
    ['the sidebar returns to the project', () => shownIssues(sidebar, [7], 'beta')],
  ];
  for (const [trigger, before] of steps) {
    await before();
    const count: number = reads.length;
    const updated = data.reportPresence(shownAlpha);
    assert.deepEqual(
      reads.slice(count).map(read => [read.projectId, read.query]),
      [['alpha', { filter: openNoFilter, cursor: null }]],
      `the first page updates once ${trigger}`,
    );
    assert.deepEqual([numbers(lists()), lists()?.loading], [[1], true], 'the kept rows show meanwhile');
    lastOf(reads).answer(page([1]));
    await updated;
  }
  const before = reads.length;
  await data.reportPresence({ visible: true, foreground: true, projectId: 'alpha' });
  assert.equal(reads.length, before, 'the same presence again asks nothing');
});

test('an update reported while the first page is still loading joins it', async () => {
  const { data, reads, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  const updated = data.reportPresence({ visible: true, foreground: true, projectId: 'alpha' });
  assert.equal(reads.length, 1);
  reads[0].answer(page([1]));
  await Promise.all([shown, updated]);
  assert.deepEqual(numbers(lists()), [1]);
});

test('a failed update keeps the rows beside the failure, and is not retried', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [1]);
  await data.reportPresence({ visible: true, foreground: false, projectId: 'alpha' });
  const updated = data.reportPresence({ visible: true, foreground: true, projectId: 'alpha' });
  reads[1].answer({ ok: false, failure: { kind: 'transient', detail: 'HTTP 502', forge }, account: null });
  await updated;
  assert.deepEqual(numbers(lists()), [1]);
  assert.deepEqual(lists()?.issues.failed?.failure, { kind: 'transient', detail: 'HTTP 502', forge });
  assert.equal(reads.length, 2, 'nothing retries the failed update');
});

test('forgetting a project, as a binding change does, drops its kept rows and details, and a read on its way for the old binding is not kept', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists, shownDetail, events } = sidebar;
  await shownIssues(sidebar, [1]);
  const opened = data.showDetail('alpha', { kind: 'issue', number: 1 });
  reads[1].answer(detail(1, 'Old repository'));
  await opened;
  const reloading = data.reloadChanged('alpha', { kind: 'issue', number: 1 });
  data.forget('alpha');
  reads[2].answer(detail(1, 'Old repository again'));
  reads[3].answer(byNumber([{ ...issue(1), title: 'Old repository again' }]));
  await reloading;
  const count = events.length;
  void data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  assert.equal(lists()?.issues.loaded, null, 'no rows of the old repository show');
  void data.showDetail('alpha', { kind: 'issue', number: 1 });
  assert.equal(
    events.slice(count).some(event => event.kind === 'forgeDetail'),
    false,
    'no detail of the old repository shows',
  );
  assert.equal(detailTitle(shownDetail()), 'Old repository');
});

test('a direct action or dispatch reported on an item reads its row by number and its open detail, and its row shows the new state where it was', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists, shownDetail } = sidebar;
  await shownIssues(sidebar, [4, 3, 2]);
  const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
  reads[1].answer(detail(3, 'Open'));
  await opened;
  const reloaded = data.reloadChanged('alpha', { kind: 'issue', number: 3 });
  assert.deepEqual(
    reads.slice(2).map(({ query, item, byNumber }) => query ?? item ?? byNumber),
    [
      { kind: 'issue', number: 3 },
      { kind: 'issue', numbers: [3] },
    ],
    'no page is read; the detail and the row are asked at once',
  );
  const closed = { state: 'closed', closedAs: 'completed' } as const;
  reads[2].answer(detail(3, 'Closed', closed));
  reads[3].answer(byNumber([{ ...issue(3), title: 'Closed', ...closed }]));
  await reloaded;
  assert.equal(detailTitle(shownDetail()), 'Closed');
  assert.deepEqual(
    lists()?.issues.loaded?.items.map(({ number, title, state, closedAs }) => ({ number, title, state, closedAs })),
    [
      { number: 4, title: 'Issue 4', state: 'open', closedAs: null },
      { number: 3, title: 'Closed', state: 'closed', closedAs: 'completed' },
      { number: 2, title: 'Issue 2', state: 'open', closedAs: null },
    ],
    'the row no longer open stays in place with its new state',
  );
  const dispatched = data.reloadChanged('alpha', { kind: 'issue', number: 2 });
  assert.deepEqual(
    reads.slice(4).map(({ item, byNumber }) => item ?? byNumber),
    [{ kind: 'issue', numbers: [2] }],
    'an item not open in the detail has only its row read',
  );
  reads[4].answer(byNumber([{ ...issue(2), title: 'Dispatched' }]));
  await dispatched;
  assert.equal(detailTitle(shownDetail()), 'Closed', 'the open detail stays on its item');
  assert.equal(lists()?.issues.loaded?.items[2].title, 'Dispatched');
});

test('showing the sidebar again pushes the cached rows at once, then updates the first page in place', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [3, 2, 1]);
  await data.reportPresence({ visible: false, foreground: true, projectId: 'alpha' });
  const updated = data.reportPresence({ visible: true, foreground: true, projectId: 'alpha' });
  void data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  assert.deepEqual(numbers(lists()), [3, 2, 1], 'the cache shows before the forge answers');
  assert.equal(lists()?.loading, true);
  assert.deepEqual(
    reads.slice(1).map(read => read.query),
    [{ filter: openNoFilter, cursor: null }],
    'one background read of the first page',
  );
  reads[1].answer({ ...page([4, 3, 1]), items: [issue(4), { ...issue(3), title: 'Renamed' }, issue(1)] });
  await updated;
  assert.deepEqual(numbers(lists()), [4, 3, 2, 1], 'a new row joins where the forge lists it; one gone stays in place');
  assert.equal(lists()?.issues.loaded?.items[1].title, 'Renamed');
  assert.equal(lists()?.loading, false);
});

test('the lists of the 5 projects shown last are kept; showing a sixth drops those shown longest ago', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  for (const projectId of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) await shownIssues(sidebar, [1], projectId);
  const count = reads.length;
  void data.showList('p2', { tab: 'issues', filter: openNoFilter });
  assert.deepEqual(numbers(lists('p2')), [1], 'a kept project shows its rows at once');
  void data.showList('p1', { tab: 'issues', filter: openNoFilter });
  assert.deepEqual(lists('p1')?.issues.loaded, null, 'the project shown longest ago starts empty');
  assert.deepEqual(
    reads.slice(count).map(read => read.projectId),
    ['p1'],
    'only the dropped project reads its first page',
  );
});

test('a project whose lists were dropped for a sixth updates afresh once shown again, not joining its update from before', async () => {
  const sidebar = sidebarData();
  const { data, reads } = sidebar;
  const behind = { visible: true, foreground: false, projectId: 'p1' };
  await shownIssues(sidebar, [1], 'p1');
  await data.reportPresence(behind);
  void data.reportPresence({ ...behind, foreground: true });
  for (const projectId of ['p2', 'p3', 'p4', 'p5', 'p6']) await shownIssues(sidebar, [1], projectId);
  await shownIssues(sidebar, [1], 'p1');
  await data.reportPresence(behind);
  const count = reads.length;
  const updated = data.reportPresence({ ...behind, foreground: true });
  assert.deepEqual(
    reads.slice(count).map(read => [read.projectId, read.query]),
    [['p1', { filter: openNoFilter, cursor: null }]],
    'the update reads its first page',
  );
  lastOf(reads).answer(page([1]));
  await updated;
});

test("each tab keeps only its latest filter's rows, and switching to a kept tab shows them at once while they update", async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [1]);
  const pullRequests = data.showList('alpha', { tab: 'pullRequests', filter: openNoFilter });
  reads[1].answer(page([]));
  await pullRequests;
  const searched = data.showList('alpha', { tab: 'issues', filter: { ...openNoFilter, search: 'x' } });
  reads[2].answer(page([5]));
  await searched;
  void data.showList('alpha', { tab: 'pullRequests', filter: openNoFilter });
  assert.deepEqual(
    [lists()?.pullRequests.loaded?.items, lists()?.loading],
    [[], true],
    'kept rows show while updating',
  );
  assert.deepEqual(reads[3].query, { filter: openNoFilter, cursor: null });
  reads[3].answer(page([]));
  void data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  assert.deepEqual(reads[4].query, { filter: openNoFilter, cursor: null }, 'an earlier filter of the tab is not kept');
  assert.deepEqual(numbers(lists()), [5], 'the rows of the latest filter show until the first page answers');
});

test('the 50 details used last are kept across projects: a kept one shows at once when opened, then updates', async () => {
  const { data, reads, shownDetail } = sidebarData();
  for (let number = 1; number <= 51; number++) {
    const opened = data.showDetail(number % 2 ? 'alpha' : 'beta', { kind: 'issue', number });
    lastOf(reads).answer(detail(number, `Kept ${number}`));
    await opened;
  }
  const count = reads.length;
  void data.showDetail('beta', { kind: 'issue', number: 2 });
  assert.equal(detailTitle(shownDetail('beta')), 'Kept 2', 'a kept detail shows before the forge answers');
  assert.deepEqual(reads[count].item, { kind: 'issue', number: 2 }, 'and is read again');
  void data.showDetail('alpha', { kind: 'issue', number: 1 });
  assert.equal(detailTitle(shownDetail('alpha')), 'Kept 51', 'the detail used longest ago is not kept');
});
