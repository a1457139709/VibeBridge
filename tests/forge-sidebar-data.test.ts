import test from 'node:test';
import assert from 'node:assert/strict';
import type { ForgeSidebarData } from '../app/main/forge/forge-sidebar-data';
import type { RepositoryChoices } from '../app/shared/forge/forge';
import type { ShownRepositoryChoices } from '../app/shared/forge/sidebar-data';
import { openNoFilter } from './support/bound-workbench';
import { detail, forge, numbers, page, sidebarData } from './support/sidebar-data-sources';

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
    failed: null,
  });
  const closed = data.showDetail('alpha', { kind: 'issue', number: 4 });
  await data.showDetail('alpha', null);
  reads[2].answer(detail(4));
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

test('hiding the lists or forgetting the project drops the detail with its answer still on its way', async () => {
  const drops = {
    hidden: (data: ForgeSidebarData) => data.reportPresence({ visible: false, foreground: true, projectId: 'alpha' }),
    forgotten: (data: ForgeSidebarData) => data.forget('alpha'),
  };
  for (const [name, drop] of Object.entries(drops)) {
    const { data, reads, events } = sidebarData();
    const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
    await drop(data);
    const count = events.length;
    reads[0].answer(detail(3));
    await opened;
    assert.equal(events.length, count, `nothing is pushed for a detail ${name}`);
    await data.refresh('alpha');
    assert.equal(reads.length, 1, `a detail ${name} is not reloaded`);
  }
});

test('a refresh reloads every page from the first through the one holding the last row shown, and drops rows the filter no longer matches', async () => {
  const { data, reads, readNumber, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([1, 2], 'p2'));
  await shown;
  for (const [index, numbers, cursor] of [
    [1, [3, 4], 'p3'],
    [2, [5, 6], null],
  ] as const) {
    const more = data.loadMore('alpha');
    reads[index].answer(page([...numbers], cursor));
    await more;
  }
  await data.showRows('alpha', [3, 4]);
  const refreshed = data.refresh('alpha');
  assert.deepEqual(reads[3].query, { filter: openNoFilter, cursor: null });
  reads[3].answer(page([1, 2], 'p2'));
  const second = await readNumber(5);
  assert.deepEqual(second.query, { filter: openNoFilter, cursor: 'p2' });
  assert.deepEqual(numbers(lists()), [1, 2, 3, 4, 5, 6], 'the old rows stay until the reload settles');
  assert.equal(lists()?.loading, true);
  second.answer(page([4], 'p3'));
  await refreshed;
  assert.equal(reads.length, 5, 'no page after the one shown is read');
  assert.deepEqual(numbers(lists()), [1, 2, 4], 'issue 3 no longer matches, and the rows after the page shown go');
  assert.equal(lists()?.issues.loaded?.cursor, 'p3', 'Load more continues after the pages reloaded');
  assert.equal(lists()?.loading, false);
});

test('after a background update adds rows, a refresh still reloads through the page holding the last row shown', async () => {
  const { data, reads, readNumber, lists } = sidebarData();
  const behind = { visible: true, foreground: false, projectId: 'alpha' };
  await data.reportPresence(behind);
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([1, 2], 'p2'));
  await shown;
  for (const [index, numbers, cursor] of [
    [1, [3, 4], 'p3'],
    [2, [5, 6], null],
  ] as const) {
    const more = data.loadMore('alpha');
    reads[index].answer(page([...numbers], cursor));
    await more;
  }
  const updated = data.reportPresence({ ...behind, foreground: true });
  reads[3].answer(page([8, 7], 'p2'));
  await updated;
  await data.showRows('alpha', [5, 6]);
  const refreshed = data.refresh('alpha');
  // The rows the update added push each row after them down the forge's pages: rows 5 and 6 now sit on a fourth.
  for (const [count, cursor, answer] of [
    [5, null, page([8, 7], 'p2')],
    [6, 'p2', page([1, 2], 'p3')],
    [7, 'p3', page([3, 4], 'p4')],
    [8, 'p4', page([5, 6], null)],
  ] as const) {
    const read = await readNumber(count);
    assert.deepEqual(read.query, { filter: openNoFilter, cursor }, `page ${count - 4} is reloaded`);
    read.answer(answer);
  }
  await refreshed;
  assert.deepEqual(numbers(lists()), [8, 7, 1, 2, 3, 4, 5, 6], 'the rows shown are reloaded');
});

test('with no rows shown a refresh reloads the first page only', async () => {
  const { data, reads, lists } = sidebarData();
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([1], 'p2'));
  await shown;
  const more = data.loadMore('alpha');
  reads[1].answer(page([2]));
  await more;
  const refreshed = data.refresh('alpha');
  reads[2].answer(page([1], 'p2'));
  await refreshed;
  assert.equal(reads.length, 3);
  assert.deepEqual(numbers(lists()), [1]);
});

test('a failed reread of the open detail keeps its shown answer beside the failure; with none shown the failure shows', async () => {
  const { data, reads, shownDetail } = sidebarData();
  const item = { kind: 'issue', number: 3 } as const;
  const failure = { kind: 'transient', detail: 'HTTP 502', forge } as const;
  const failing = data.showDetail('alpha', item);
  reads[0].answer({ ok: false, failure });
  await failing;
  assert.deepEqual(shownDetail(), { item, result: { ok: false, failure }, failed: null }, 'nothing is kept to show');
  const opened = data.showDetail('alpha', item);
  reads[1].answer(detail(3, 'Before'));
  await opened;
  const rereads = {
    refresh: () => data.refresh('alpha'),
    'direct action': () => data.reloadChanged('alpha', item),
    'reopening the kept detail': () => data.showDetail('alpha', item),
  };
  for (const [reread, start] of Object.entries(rereads)) {
    const settled = start();
    reads.at(-1)!.answer({ ok: false, failure });
    await settled;
    assert.deepEqual(
      shownDetail(),
      { item, result: detail(3, 'Before'), failed: failure },
      `after a failed ${reread} the shown answer stays, and may be stale`,
    );
  }
  const updated = data.refresh('alpha');
  reads.at(-1)!.answer(detail(3, 'After'));
  await updated;
  assert.deepEqual(shownDetail(), { item, result: detail(3, 'After'), failed: null }, 'the next answer clears it');
});
