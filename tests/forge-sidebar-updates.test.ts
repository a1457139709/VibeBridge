import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhIssue, type GhPullRequest } from './support/gh-double';
import { boundWorkbench, day, forgeAccount, showList, shownDetail, shownLists } from './support/bound-workbench';
import type { ForgeLists } from '../app/shared/forge/sidebar-data';

// The Forge sidebar's background update reads the first page again, the visible rows by number, and the open detail
// (docs/adr/0008-forge-sidebar-data-lives-in-the-main-process.md).

/** 30 open issues, #1 the oldest, created a day apart. */
const thirtyIssues: GhIssue[] = Array.from({ length: 30 }, (_, index) => ({
  number: index + 1,
  title: `Issue ${index + 1}`,
  state: 'OPEN',
  createdAt: day(index),
  labels: [],
}));

/** What each `gh` call asked of GitHub: a search, the items it read by number, or one item's detail. */
const asked = (calls: string[][]) =>
  calls.map(args => {
    const query = args.find(arg => arg.startsWith('query='))!;
    if (args.some(arg => arg.startsWith('search='))) return 'search';
    const read = [...query.matchAll(/(issue|pullRequest)\(number: (\d+)\)/g)];
    if (read.length) return `${read[0][1]} ${read.map(match => match[2]).join(',')}`;
    return `detail ${args.find(arg => arg.startsWith('number='))!.slice('number='.length)}`;
  });

/** The sidebar shows the project, its window behind the others: no update runs until the window comes to the front. */
const behind = (projectId: string) => ({ visible: true, foreground: false, projectId });
const inFront = (projectId: string) => ({ visible: true, foreground: true, projectId });

test('a background update searches the first page again and reads the visible rows past it by number, without a search', async context => {
  const double = await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('visible-rows');
  try {
    await f.workbench.forgeSidebar.reportPresence(behind(f.projectId));
    await showList(f.workbench, f.projectId);
    await shownLists(f.workbench, f.projectId, () => f.workbench.forgeSidebar.loadMore(f.projectId));
    await f.workbench.forgeSidebar.showRows(f.projectId, [3, 2, 1]);
    await double.set({
      ...forgeAccount,
      issues: thirtyIssues
        .filter(issue => issue.number !== 1)
        .map(issue =>
          issue.number === 3
            ? { ...issue, title: 'Closed while scrolled past', state: 'CLOSED', stateReason: 'COMPLETED' }
            : issue,
        ),
    });
    await double.calls();
    const lists = await shownLists(f.workbench, f.projectId, () =>
      f.workbench.forgeSidebar.reportPresence(inFront(f.projectId)),
    );
    assert.deepEqual((await double.calls().then(asked)).sort(), ['issue 3,2,1', 'search']);
    const rows = lists.issues.loaded!.items;
    assert.equal(rows.length, 30, 'no row is dropped');
    assert.deepEqual(
      rows.slice(-3).map(({ number, title, state, closedAs }) => ({ number, title, state, closedAs })),
      [
        { number: 3, title: 'Closed while scrolled past', state: 'closed', closedAs: 'completed' },
        { number: 2, title: 'Issue 2', state: 'open', closedAs: null },
        { number: 1, title: 'Issue 1', state: 'open', closedAs: null },
      ],
      'a visible row shows its new state where it was; one the forge no longer has stays as it was',
    );
    assert.deepEqual(rows.at(-3), {
      number: 3,
      title: 'Closed while scrolled past',
      state: 'closed',
      closedAs: 'completed',
      createdAt: day(2),
      labels: [],
      blockedBy: [],
      unlistedBlockers: 0,
      parent: null,
      subIssues: { closed: 0, total: 0, issues: [] },
    });
    assert.equal(lists.issues.failed, null, 'a visible row the forge no longer has is no failure');
  } finally {
    await f.close();
  }
});

test('the visible pull request rows are read by number, in the shape the list page has', async context => {
  const pull = (number: number, extra: Partial<GhPullRequest> = {}): GhPullRequest => ({
    number,
    title: `Change ${number}`,
    state: 'OPEN',
    createdAt: day(number),
    labels: [],
    ...extra,
  });
  const double = await ghDouble(context, { ...forgeAccount, pullRequests: [pull(12), pull(13)] });
  const f = await boundWorkbench('visible-pull-requests');
  try {
    await f.workbench.forgeSidebar.reportPresence(behind(f.projectId));
    await showList(f.workbench, f.projectId, 'pullRequests');
    await f.workbench.forgeSidebar.showRows(f.projectId, [12]);
    const merged = pull(12, { state: 'MERGED', checks: 'SUCCESS', labels: [{ name: 'ui', color: '7057ff' }] });
    await double.set({ ...forgeAccount, pullRequests: [merged, pull(13)] });
    await double.calls();
    const lists = await shownLists(f.workbench, f.projectId, () =>
      f.workbench.forgeSidebar.reportPresence(inFront(f.projectId)),
    );
    assert.deepEqual((await double.calls().then(asked)).sort(), ['pullRequest 12', 'search']);
    assert.deepEqual(lists.pullRequests.loaded?.items, [
      { number: 13, title: 'Change 13', state: 'open', createdAt: day(13), author: 'octo', checks: 'none', labels: [] },
      {
        number: 12,
        title: 'Change 12',
        state: 'merged',
        createdAt: day(12),
        author: 'octo',
        checks: 'passed',
        labels: [{ name: 'ui', color: '7057ff' }],
      },
    ]);
  } finally {
    await f.close();
  }
});

test('the three parts of a background update are asked at once: each waits for the others to be asked', async context => {
  const double = await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('parallel-update');
  try {
    await f.workbench.forgeSidebar.reportPresence(behind(f.projectId));
    await showList(f.workbench, f.projectId);
    await shownLists(f.workbench, f.projectId, () => f.workbench.forgeSidebar.loadMore(f.projectId));
    await shownDetail(f.workbench, f.projectId, { kind: 'issue', number: 30 });
    await f.workbench.forgeSidebar.showRows(f.projectId, [2]);
    await double.set({ ...forgeAccount, issues: thirtyIssues, answerOnceAsked: 3 });
    await double.calls();
    let lists: ForgeLists | undefined;
    const detail = await shownDetail(f.workbench, f.projectId, { kind: 'issue', number: 30 }, async () => {
      lists = await shownLists(f.workbench, f.projectId, () =>
        f.workbench.forgeSidebar.reportPresence(inFront(f.projectId)),
      );
    });
    assert.deepEqual((await double.calls().then(asked)).sort(), ['detail 30', 'issue 2', 'search']);
    assert.equal(lists?.issues.failed, null);
    assert.equal(detail.ok, true);
  } finally {
    await f.close();
  }
});
