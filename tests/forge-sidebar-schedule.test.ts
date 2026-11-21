import test from 'node:test';
import assert from 'node:assert/strict';
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

// What a background update of the Forge sidebar's data asks, and how its answers show
// (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md).

const inFront: ForgeSidebarPresence = { visible: true, foreground: true, projectId: 'alpha' };
/** What each read asks for: a page, an item's detail, or items by number. */
const asked = (reads: ReturnType<typeof sidebarData>['reads']) =>
  reads.map(({ query, item, byNumber }) => query ?? item ?? byNumber);

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
