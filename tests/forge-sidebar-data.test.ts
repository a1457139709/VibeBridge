import test from 'node:test';
import assert from 'node:assert/strict';
import { ForgeSidebarData } from '../app/main/forge/forge-sidebar-data';
import type { IssuePage, ListQuery, ListedIssue, RepositoryChoices } from '../app/shared/forge/forge';
import type { ForgeLists, ForgeSidebarEvent, ShownRepositoryChoices } from '../app/shared/forge/sidebar-data';
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
const page = (numbers: number[], cursor: string | null = null): IssuePage => ({
  ok: true,
  items: numbers.map(issue),
  cursor,
  labels: [],
  counts: { open: numbers.length, closed: 0 },
});

/** The module over sources whose every read waits until the test answers it. */
function sidebarData() {
  const reads: { projectId: string; query?: ListQuery; answer(value: unknown): void; fail(error: Error): void }[] = [];
  const read = (projectId: string, query?: ListQuery) =>
    new Promise<never>((answer, fail) => reads.push({ projectId, query, answer: answer as never, fail }));
  const events: ForgeSidebarEvent[] = [];
  const data = new ForgeSidebarData({
    issuePage: read,
    pullRequestPage: read,
    repositoryChoices: projectId => read(projectId),
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
  return { data, reads, events, lists, choices };
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
