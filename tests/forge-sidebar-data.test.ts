import test from 'node:test';
import assert from 'node:assert/strict';
import { ForgeSidebarData } from '../app/main/forge/forge-sidebar-data';
import type {
  IssueDetail,
  IssueDetailResult,
  IssuePage,
  ListQuery,
  ListedIssue,
  RepositoryChoices,
} from '../app/shared/forge/forge';
import type {
  DetailItem,
  ForgeLists,
  ForgeSidebarEvent,
  ShownRepositoryChoices,
} from '../app/shared/forge/sidebar-data';
import { openNoFilter } from './support/bound-workbench';

const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
const issue = (number: number): ListedIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  labels: [],
  blockedBy: [],
  unlistedBlockers: 0,
  parent: null,
  subIssues: { closed: 0, total: 0, issues: [] },
});
/** An issue's detail as the forge answers it, titled `title`. */
const detail = (number: number, title = `Issue ${number}`): IssueDetailResult => ({
  ok: true,
  issue: { ...issue(number), title } as unknown as IssueDetail,
});
const page = (numbers: number[], cursor: string | null = null): IssuePage => ({
  ok: true,
  items: numbers.map(issue),
  cursor,
  labels: [],
  counts: { open: numbers.length, closed: 0 },
});

/** The module over sources whose every read waits until the test answers it. */
function sidebarData() {
  const reads: {
    projectId: string;
    query?: ListQuery;
    item?: DetailItem;
    answer(value: unknown): void;
    fail(error: Error): void;
  }[] = [];
  const read = (projectId: string, query?: ListQuery, item?: DetailItem) =>
    new Promise<never>((answer, fail) => reads.push({ projectId, query, item, answer: answer as never, fail }));
  const events: ForgeSidebarEvent[] = [];
  const data = new ForgeSidebarData({
    issuePage: read,
    pullRequestPage: read,
    repositoryChoices: projectId => read(projectId),
    issueDetail: (projectId, number) => read(projectId, undefined, { kind: 'issue', number }),
    pullRequestDetail: (projectId, number) => read(projectId, undefined, { kind: 'pullRequest', number }),
    forge: () => forge,
    emit: event => events.push(event),
  });
  const lists = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'forgeLists' }> =>
        event.kind === 'forgeLists' && event.projectId === projectId,
    )?.lists;
  const choices = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'repositoryChoices' }> =>
        event.kind === 'repositoryChoices' && event.projectId === projectId,
    )?.choices;
  const shownDetail = (projectId = 'alpha') =>
    events.findLast(
      (event): event is Extract<ForgeSidebarEvent, { kind: 'forgeDetail' }> =>
        event.kind === 'forgeDetail' && event.projectId === projectId,
    )?.detail;
  return { data, reads, events, lists, choices, shownDetail };
}
const numbers = (lists: ForgeLists | undefined) => lists?.issues.loaded?.items.map(item => item.number);

test('only the latest request settles the lists: an answer for a filter no longer shown is dropped', async () => {
  const { data, reads, lists } = sidebarData();
  const first = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  const second = data.showList('alpha', { tab: 'issues', filter: { ...openNoFilter, search: 'x' } });
  assert.equal(lists()?.loading, true);
  reads[1].answer(page([5]));
  await second;
  assert.deepEqual(numbers(lists()), [5]);
  reads[0].answer(page([9]));
  await first;
  assert.deepEqual(numbers(lists()), [5], 'the older answer does not replace the rows');
  assert.equal(lists()?.loading, false);
});

test('a failure after rows keeps them beside it, and the next page that loads clears it', async () => {
  const { data, reads, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([1]));
  await shown;
  const refreshed = data.refresh('alpha');
  assert.deepEqual(reads[1].query, { filter: openNoFilter, cursor: null });
  reads[1].answer({ ok: false, failure: { kind: 'transient', detail: 'HTTP 502', forge }, account: null });
  await refreshed;
  assert.deepEqual(numbers(lists()), [1]);
  assert.deepEqual(lists()?.issues.failed?.failure, { kind: 'transient', detail: 'HTTP 502', forge });
  const again = data.refresh('alpha');
  reads[2].answer(page([2]));
  await again;
  assert.deepEqual(numbers(lists()), [2]);
  assert.equal(lists()?.issues.failed, null);
});

test('a request that fails outside the forge is a transient failure with its reason', async () => {
  const { data, reads, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].fail(new Error('No repository bound'));
  await shown;
  assert.deepEqual(lists()?.issues, {
    loaded: null,
    failed: { ok: false, failure: { kind: 'transient', detail: 'No repository bound', forge }, account: null },
  });
});

test('Load more continues the filter of the rows shown, and each tab keeps its own rows', async () => {
  const { data, reads, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([9], 'next'));
  await shown;
  const more = data.loadMore('alpha');
  assert.deepEqual(reads[1].query, { filter: openNoFilter, cursor: 'next' });
  reads[1].answer(page([8]));
  await more;
  assert.deepEqual(numbers(lists()), [9, 8]);
  await data.loadMore('alpha');
  assert.equal(reads.length, 2, 'the last page has no more to load');
  const pullRequests = data.showList('alpha', { tab: 'pullRequests', filter: openNoFilter });
  reads[2].answer({ ...page([]), items: [] });
  await pullRequests;
  assert.deepEqual(numbers(lists()), [9, 8], 'the issues tab keeps its rows while another tab shows');
  assert.deepEqual(lists()?.pullRequests.loaded?.items, []);
});

test('a hidden list is dropped with the answer still on its way, and showing it again starts empty', async () => {
  const { data, reads, lists, events } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([1]));
  await shown;
  const refreshed = data.refresh('alpha');
  data.hideList('alpha');
  const count = events.length;
  reads[1].answer(page([2]));
  await refreshed;
  assert.equal(events.length, count, 'nothing is pushed for a hidden list');
  void data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  assert.deepEqual(lists(), {
    issues: { loaded: null, failed: null },
    pullRequests: { loaded: null, failed: null },
    loading: true,
  });
});

test('the repositories a project can bind are read once per call, only the latest read settles, and a failed read carries its reason', async () => {
  const { data, reads, choices } = sidebarData();
  const listed: RepositoryChoices = { ok: true, forge, account: 'octo', repositories: [], origin: null };
  const first = data.showRepositoryChoices('alpha');
  assert.equal(choices(), null, 'null while reading');
  const retried = data.showRepositoryChoices('alpha');
  assert.equal(reads.length, 2);
  reads[1].answer(listed);
  await retried;
  reads[0].fail(new Error('stale'));
  await first;
  assert.deepEqual(choices(), listed satisfies ShownRepositoryChoices);
  const failing = data.showRepositoryChoices('alpha');
  reads[2].fail(new Error('Project missing'));
  await failing;
  assert.deepEqual(choices(), { ok: false, error: 'Project missing' });
});

test('forgetting a project, as a binding change does, drops its lists and choices with the answers still on their way', async () => {
  const { data, reads, events } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  const choices = data.showRepositoryChoices('alpha');
  data.forget('alpha');
  const count = events.length;
  reads[0].answer(page([1]));
  reads[1].answer({ ok: true, forge, account: 'octo', repositories: [], origin: null });
  await Promise.all([shown, choices]);
  assert.equal(events.length, count, 'nothing is pushed for a forgotten project');
  await data.refresh('alpha');
  await data.loadMore('alpha');
  assert.equal(reads.length, 2, 'a list not shown is not read');
});

test('the detail pushes the answer for the item declared, and only the latest declaration settles it', async () => {
  const { data, reads, shownDetail } = sidebarData();
  const first = data.showDetail('alpha', { kind: 'issue', number: 3 });
  const second = data.showDetail('alpha', { kind: 'pullRequest', number: 12 });
  assert.deepEqual(reads[1].item, { kind: 'pullRequest', number: 12 });
  reads[0].answer(detail(3));
  await first;
  assert.equal(shownDetail(), undefined, 'the answer for an item no longer declared is dropped');
  reads[1].fail(new Error('No repository bound'));
  await second;
  assert.deepEqual(shownDetail(), {
    item: { kind: 'pullRequest', number: 12 },
    result: { ok: false, failure: { kind: 'transient', detail: 'No repository bound', forge } },
  });
  const closed = data.showDetail('alpha', { kind: 'issue', number: 3 });
  await data.showDetail('alpha', null);
  reads[2].answer(detail(3));
  await closed;
  assert.equal(shownDetail()?.item.kind, 'pullRequest', 'nothing is pushed for a closed detail');
  await data.refresh('alpha');
  assert.equal(reads.length, 3, 'a closed detail is not reloaded');
  await assert.rejects(data.showDetail('alpha', { kind: 'issue', number: 0 }), 'only a positive number is shown');
});

test('a refresh reloads the first page and the open detail', async () => {
  const { data, reads, lists, shownDetail } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([3]));
  await shown;
  const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
  reads[1].answer(detail(3, 'Before'));
  await opened;
  const refreshed = data.refresh('alpha');
  assert.deepEqual(
    reads.slice(2).map(({ query, item }) => query ?? item),
    [
      { filter: openNoFilter, cursor: null },
      { kind: 'issue', number: 3 },
    ],
  );
  reads[2].answer(page([3, 4]));
  reads[3].answer(detail(3, 'After'));
  await refreshed;
  assert.deepEqual(numbers(lists()), [3, 4]);
  assert.deepEqual(shownDetail()?.result, detail(3, 'After'));
});

test('a direct action or dispatch reported on an item reloads the first page and the open detail', async () => {
  const { data, reads, shownDetail } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([3]));
  await shown;
  const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
  reads[1].answer(detail(3, 'Open'));
  await opened;
  const reloaded = data.reloadChanged('alpha', { kind: 'issue', number: 3 });
  assert.deepEqual(
    reads.slice(2).map(({ query, item }) => query ?? item),
    [
      { filter: openNoFilter, cursor: null },
      { kind: 'issue', number: 3 },
    ],
  );
  reads[2].answer(page([]));
  reads[3].answer(detail(3, 'Closed'));
  await reloaded;
  assert.deepEqual(shownDetail()?.result, detail(3, 'Closed'));
});

test('hiding the lists or forgetting the project drops the detail with its answer still on its way', async () => {
  for (const drop of ['hideList', 'forget'] as const) {
    const { data, reads, events } = sidebarData();
    const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
    data[drop]('alpha');
    const count = events.length;
    reads[0].answer(detail(3));
    await opened;
    assert.equal(events.length, count, `nothing is pushed for a detail dropped by ${drop}`);
    await data.refresh('alpha');
    assert.equal(reads.length, 1, `a detail dropped by ${drop} is not reloaded`);
  }
});
