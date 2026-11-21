import test from 'node:test';
import assert from 'node:assert/strict';
import { updateInterval } from '../app/main/forge/background-updates';
import type { ForgeSidebarPresence } from '../app/shared/forge/sidebar-data';
import { openNoFilter } from './support/bound-workbench';
import {
  answersTakenIn,
  byNumber,
  detail,
  forge,
  issue,
  numbers,
  page,
  shownIssues,
  sidebarData,
} from './support/sidebar-data-sources';

// The Forge sidebar's data updates in the background every 5 minutes while the sidebar shows a project in the
// foreground, and an update reported while one runs joins it (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md).

const inFront: ForgeSidebarPresence = { visible: true, foreground: true, projectId: 'alpha' };
const minute = 60_000;
/** What each read asks for: a page, an item's detail, or items by number. */
const asked = (reads: ReturnType<typeof sidebarData>['reads']) =>
  reads.map(({ query, item, byNumber }) => query ?? item ?? byNumber);

test('every 5 minutes while the sidebar shows a project in the foreground its data updates; hidden or behind, the count pauses, and it starts again once the project shows', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sidebar = sidebarData();
  const { data, reads } = sidebar;
  await shownIssues(sidebar, [1]);
  t.mock.timers.tick(updateInterval - 1);
  assert.equal(reads.length, 1, 'nothing updates before 5 minutes pass');
  t.mock.timers.tick(1);
  assert.deepEqual(
    asked(reads.slice(1)),
    [{ filter: openNoFilter, cursor: null }],
    'the first page updates at 5 minutes',
  );
  reads[1].answer(page([1]));
  await answersTakenIn();
  for (const away of [
    { ...inFront, foreground: false },
    { ...inFront, visible: false },
  ]) {
    t.mock.timers.tick(4 * minute);
    await data.reportPresence(away);
    const count: number = reads.length;
    t.mock.timers.tick(10 * minute);
    assert.equal(reads.length, count, `nothing updates while ${away.visible ? 'behind' : 'hidden'}`);
    const shown = data.reportPresence(inFront);
    assert.equal(reads.length, count + 1, 'showing the project again updates it at once');
    reads.at(-1)!.answer(page([1]));
    await shown;
    t.mock.timers.tick(updateInterval - 1);
    assert.equal(reads.length, count + 1, 'the count starts again from when the project shows');
    t.mock.timers.tick(1);
    assert.equal(reads.length, count + 2, 'and updates 5 minutes later');
    reads.at(-1)!.answer(page([1]));
    await answersTakenIn();
  }
});

test('an update reported while one runs joins it: no read is asked twice, and the schedule goes on after it', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [3, 2]);
  const opened = data.showDetail('alpha', { kind: 'issue', number: 3 });
  reads[1].answer(detail(3));
  await opened;
  await data.showRows('alpha', [3, 2]);
  await data.reportPresence({ ...inFront, foreground: false });
  const updating = data.reportPresence(inFront);
  const count = reads.length;
  t.mock.timers.tick(updateInterval);
  await data.reportPresence({ ...inFront, foreground: false });
  const joined = data.reportPresence(inFront);
  assert.equal(reads.length, count, 'the scheduled update and the window back in front join the running one');
  assert.deepEqual(
    asked(reads.slice(2)),
    [
      { filter: openNoFilter, cursor: null },
      { kind: 'issue', numbers: [3, 2] },
      { kind: 'issue', number: 3 },
    ],
    'one update asks each part once',
  );
  reads[2].answer(page([3, 2]));
  reads[4].answer(detail(3));
  await answersTakenIn();
  reads[3].answer(byNumber([{ ...issue(2), title: 'Updated' }]));
  await Promise.all([updating, joined]);
  assert.equal(lists()?.issues.loaded?.items[1].title, 'Updated');
  t.mock.timers.tick(updateInterval);
  assert.equal(reads.length, count + 3, 'the next scheduled update asks again');
});

test('a background update asks the first page, the rendered rows by number and the open detail at once, and a row past the first page shows its new state where it is', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  void data.reportPresence(inFront);
  const shown = data.showList('alpha', { tab: 'issues', filter: openNoFilter });
  reads[0].answer(page([4, 3], 'next'));
  await shown;
  const appended = data.loadMore('alpha');
  reads[1].answer(page([2, 1]));
  await appended;
  const opened = data.showDetail('alpha', { kind: 'issue', number: 4 });
  reads[2].answer(detail(4));
  await opened;
  await data.showRows('alpha', [3, 2]);
  await data.reportPresence({ ...inFront, foreground: false });
  const updated = data.reportPresence(inFront);
  assert.deepEqual(
    asked(reads.slice(3)),
    [
      { filter: openNoFilter, cursor: null },
      { kind: 'issue', numbers: [3, 2] },
      { kind: 'issue', number: 4 },
    ],
    'each part is asked before any answers',
  );
  reads[5].answer(detail(4));
  reads[4].answer(byNumber([{ ...issue(2), state: 'closed', closedAs: 'completed' }]));
  reads[3].answer(page([4, 3], 'next'));
  await updated;
  assert.deepEqual(numbers(lists()), [4, 3, 2, 1]);
  assert.equal(lists()?.issues.loaded?.items[2].state, 'closed');
});

test('a failed read of the rendered rows shows beside the rows once the first page answered, and is not retried', async () => {
  const sidebar = sidebarData();
  const { data, reads, lists } = sidebar;
  await shownIssues(sidebar, [2, 1]);
  await data.showRows('alpha', [1]);
  await data.reportPresence({ ...inFront, foreground: false });
  const updated = data.reportPresence(inFront);
  const failure = { kind: 'transient', detail: 'HTTP 502', forge } as const;
  reads[2].answer({ ok: false, failure, account: null });
  await answersTakenIn();
  reads[1].answer(page([2, 1]));
  await updated;
  assert.deepEqual(numbers(lists()), [2, 1], 'the rows stay');
  assert.deepEqual(lists()?.issues.failed?.failure, failure, 'the data may be stale');
  await answersTakenIn();
  assert.equal(reads.length, 3, 'nothing retries the failed read');
});
