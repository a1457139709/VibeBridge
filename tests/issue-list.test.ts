import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhIssue } from './support/gh-double';
import type { ListFilter } from '../app/shared/forge/forge';
import {
  boundWorkbench,
  day,
  forgeAccount,
  openNoFilter,
  refreshList,
  showList,
  shownLists,
} from './support/bound-workbench';

const thirtyIssues: GhIssue[] = Array.from({ length: 30 }, (_, index) => ({
  number: index + 1,
  title: `Issue ${index + 1}`,
  state: 'OPEN',
  createdAt: day(index),
  labels: [],
}));

test('showing the list loads one page of 25 issues, newest first, and Load more appends the rest', async context => {
  await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('issue-page');
  try {
    const { issues: first } = await showList(f.workbench, f.projectId);
    assert.equal(first.failed, null);
    assert.ok(first.loaded);
    assert.deepEqual(first.loaded.filter, openNoFilter, 'the rows carry the filter that produced them');
    assert.deepEqual(
      first.loaded.items.map(issue => issue.number),
      Array.from({ length: 25 }, (_, index) => 30 - index),
    );
    assert.deepEqual(first.loaded.items[0], {
      number: 30,
      title: 'Issue 30',
      state: 'open',
      closedAs: null,
      createdAt: day(29),
      labels: [],
      blockedBy: [],
      unlistedBlockers: 0,
      url: 'https://github.com/octo/tools/issues/30',
      parent: null,
      subIssues: { closed: 0, total: 0, issues: [], unlisted: 0 },
    });
    assert.ok(first.loaded.nextCursor);
    const { issues: all } = await shownLists(f.workbench, f.projectId, () =>
      f.workbench.forgeSidebar.loadMore(f.projectId),
    );
    assert.deepEqual(
      all.loaded?.items.map(issue => issue.number),
      Array.from({ length: 30 }, (_, index) => 30 - index),
    );
    assert.equal(all.loaded?.nextCursor, null, 'the last page has no cursor');
  } finally {
    await f.close();
  }
});

test('the search, open or closed state and labels all narrow the page, and a closed issue says how it was closed', async context => {
  const bug = { name: 'bug', color: 'd73a4a' },
    ui = { name: 'good first issue', color: '7057ff' };
  await ghDouble(context, {
    ...forgeAccount,
    labels: [bug, ui],
    issues: [
      { number: 1, title: 'Sidebar refresh spins forever', state: 'OPEN', createdAt: day(1), labels: [bug, ui] },
      { number: 2, title: 'Sidebar width', state: 'OPEN', createdAt: day(2), labels: [bug] },
      {
        number: 3,
        title: 'Dispatch menu',
        state: 'CLOSED',
        stateReason: 'NOT_PLANNED',
        createdAt: day(3),
        labels: [ui],
      },
      { number: 12, title: 'Tray order', state: 'OPEN', createdAt: day(4), labels: [] },
    ],
  });
  const f = await boundWorkbench('issue-filters');
  try {
    const numbers = async (filter: Partial<ListFilter>) => {
      const { issues } = await showList(f.workbench, f.projectId, 'issues', { ...openNoFilter, ...filter });
      assert.ok(issues.loaded);
      return issues.loaded.items.map(issue => issue.number);
    };
    assert.deepEqual(await numbers({}), [12, 2, 1]);
    assert.deepEqual(await numbers({ search: 'sidebar' }), [2, 1], 'words match titles');
    assert.deepEqual(await numbers({ search: '#12' }), [12], 'a number matches the issue number');
    assert.deepEqual(await numbers({ search: '12' }), [12]);
    assert.deepEqual(await numbers({ labels: ['bug', 'good first issue'] }), [1], 'every chosen label must be present');
    assert.deepEqual(await numbers({ state: 'closed' }), [3]);
    const closed = (await showList(f.workbench, f.projectId, 'issues', { ...openNoFilter, state: 'closed' })).issues
      .loaded;
    assert.ok(closed);
    assert.deepEqual(closed.items[0], {
      number: 3,
      title: 'Dispatch menu',
      state: 'closed',
      closedAs: 'notPlanned',
      createdAt: day(3),
      labels: [ui],
      blockedBy: [],
      unlistedBlockers: 0,
      url: 'https://github.com/octo/tools/issues/3',
      parent: null,
      subIssues: { closed: 0, total: 0, issues: [], unlisted: 0 },
    });
    assert.deepEqual(closed.labels, [bug, ui], 'the page carries the labels the repository defines');
    assert.deepEqual(closed.counts, { open: 3, closed: 1 });
    const labelled = (
      await showList(f.workbench, f.projectId, 'issues', { ...openNoFilter, labels: ['good first issue'] })
    ).issues.loaded;
    assert.ok(labelled);
    assert.deepEqual(labelled.counts, { open: 1, closed: 1 }, 'the counts follow the search and labels, not the state');
    assert.equal(closed.nextCursor, null);
  } finally {
    await f.close();
  }
});

test("a page carries each issue's parent, its sub-issues with their progress, and only the open issues blocking it", async context => {
  const bug = { name: 'bug', color: 'd73a4a' };
  await ghDouble(context, {
    ...forgeAccount,
    issues: [
      { number: 1, title: 'Map', state: 'OPEN', createdAt: day(1), labels: [] },
      {
        number: 2,
        title: 'Done ticket',
        state: 'CLOSED',
        stateReason: 'COMPLETED',
        createdAt: day(2),
        labels: [],
        parent: 1,
      },
      {
        number: 3,
        title: 'Blocked ticket',
        state: 'OPEN',
        createdAt: day(3),
        labels: [bug],
        parent: 1,
        blockedBy: [
          2,
          4,
          { path: 'octo/other', number: 7, title: 'Upstream fix', state: 'OPEN' },
          { path: 'octo/other', number: 8, title: 'Old', state: 'CLOSED' },
        ],
      },
      { number: 4, title: 'Blocker', state: 'OPEN', createdAt: day(4), labels: [] },
    ],
  });
  const f = await boundWorkbench('issue-tree');
  try {
    assert.deepEqual(
      f.workbench.snapshot().projects.find(project => project.id === f.projectId)?.capabilities,
      {
        subIssues: true,
        blocking: true,
        requiredChecks: true,
        mergeQueue: true,
        mergeMethods: ['merge', 'squash', 'rebase'],
      },
      'the project declares the features GitHub has',
    );
    const page = (await showList(f.workbench, f.projectId)).issues.loaded;
    assert.ok(page);
    const blockers = [
      { path: null, number: 4, title: 'Blocker' },
      { path: 'octo/other', number: 7, title: 'Upstream fix' },
    ];
    assert.deepEqual(
      page.items.map(issue => issue.number),
      [4, 3, 1],
      'the page itself stays flat; the list builds the tree',
    );
    assert.deepEqual(page.items[1], {
      number: 3,
      title: 'Blocked ticket',
      state: 'open',
      closedAs: null,
      createdAt: day(3),
      labels: [bug],
      blockedBy: blockers,
      unlistedBlockers: 0,
      url: 'https://github.com/octo/tools/issues/3',
      parent: 1,
      subIssues: { closed: 0, total: 0, issues: [], unlisted: 0 },
    });
    assert.deepEqual(page.items[2].subIssues, {
      closed: 1,
      total: 2,
      unlisted: 0,
      issues: [
        {
          number: 2,
          title: 'Done ticket',
          state: 'closed',
          closedAs: 'completed',
          createdAt: day(2),
          labels: [],
          blockedBy: [],
          unlistedBlockers: 0,
        },
        {
          number: 3,
          title: 'Blocked ticket',
          state: 'open',
          closedAs: null,
          createdAt: day(3),
          labels: [bug],
          blockedBy: blockers,
          unlistedBlockers: 0,
        },
      ],
    });
  } finally {
    await f.close();
  }
});

test('an issue blocked by more issues than GitHub lists counts the open blockers it did not list', async context => {
  const closedBlockers = Array.from({ length: 20 }, (_, index) => ({
    path: 'octo/other',
    number: index + 1,
    title: `Old ${index + 1}`,
    state: 'CLOSED' as const,
  }));
  await ghDouble(context, {
    ...forgeAccount,
    issues: [
      {
        number: 1,
        title: 'Long wait',
        state: 'OPEN',
        createdAt: day(1),
        labels: [],
        blockedBy: [
          ...closedBlockers,
          { path: 'octo/other', number: 30, title: 'Still open', state: 'OPEN' },
          { path: 'octo/other', number: 31, title: 'Also open', state: 'OPEN' },
        ],
      },
    ],
  });
  const f = await boundWorkbench('issue-blockers-window');
  try {
    const page = (await showList(f.workbench, f.projectId)).issues.loaded;
    assert.ok(page);
    assert.deepEqual(
      [page.items[0].blockedBy, page.items[0].unlistedBlockers],
      [[], 2],
      'closed blockers fill the listed window; the open ones are counted',
    );
  } finally {
    await f.close();
  }
});

test('list failures fall into the four kinds with the forge text, and an inaccessible repository names the account', async context => {
  const double = await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('issue-failures');
  const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
  const page = async () => (await refreshList(f.workbench, f.projectId)).issues.failed;
  try {
    await showList(f.workbench, f.projectId);
    await double.set({ account: 'octo', repositories: [] });
    assert.deepEqual(await page(), {
      ok: false,
      account: 'octo',
      failure: {
        kind: 'inaccessible',
        forge,
        detail: "GraphQL: Could not resolve to a Repository with the name 'octo/tools'. (repository)",
      },
    });
    await double.set({
      ...forgeAccount,
      failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
    });
    assert.deepEqual(await page(), {
      ok: false,
      account: null,
      failure: { kind: 'loggedOut', forge, detail: 'To get started with GitHub CLI, please run:  gh auth login' },
    });
    await double.set({
      ...forgeAccount,
      failure: { code: 1, stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' },
    });
    assert.deepEqual(await page(), {
      ok: false,
      account: null,
      failure: { kind: 'transient', forge, detail: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' },
    });
    double.uninstall();
    assert.deepEqual(await page(), { ok: false, account: null, failure: { kind: 'notInstalled', forge, detail: '' } });
  } finally {
    await f.close();
  }
});

test('an issue with more sub-issues than GitHub lists counts them all, counts the ones the cap left out, and carries the page that lists them', async context => {
  const foreign = (number: number) => ({
    path: 'octo/other',
    number,
    title: `Upstream ${number}`,
    state: 'OPEN' as const,
  });
  await ghDouble(context, {
    ...forgeAccount,
    issues: [
      {
        number: 1,
        title: 'Epic',
        state: 'OPEN',
        createdAt: day(1),
        labels: [],
        foreignSubIssues: [foreign(7), foreign(8), foreign(9)],
      },
      {
        number: 2,
        title: 'Cross-repository',
        state: 'OPEN',
        createdAt: day(2),
        labels: [],
        foreignSubIssues: [foreign(7)],
      },
      ...Array.from({ length: 55 }, (_, index) => ({
        number: 100 + index,
        title: `Part ${index}`,
        state: 'CLOSED' as const,
        createdAt: day(0),
        labels: [],
        parent: 1,
      })),
    ],
  });
  const f = await boundWorkbench('issue-sub-issue-window');
  try {
    const page = (await showList(f.workbench, f.projectId)).issues.loaded;
    assert.ok(page);
    const issue = (number: number) => page.items.find(item => item.number === number);
    const epic = issue(1);
    assert.deepEqual(
      [epic?.url, epic?.subIssues.issues.length, epic?.subIssues.total, epic?.subIssues.unlisted],
      ['https://github.com/octo/tools/issues/1', 47, 58, 8],
      'sub-issues of another repository fill the cap but are not listed, and do not count as left out',
    );
    assert.deepEqual(
      issue(2)?.subIssues,
      { closed: 0, total: 1, issues: [], unlisted: 0 },
      'a list the cap did not cut leaves nothing out',
    );
  } finally {
    await f.close();
  }
});

const manyLabels = Array.from({ length: 230 }, (_, index) => ({
  name: `label ${String(index).padStart(3, '0')}`,
  color: 'ededed',
}));

test('a repository with more labels than one page carries every label, in both lists', async context => {
  await ghDouble(context, { ...forgeAccount, labels: manyLabels, issues: thirtyIssues });
  const f = await boundWorkbench('issue-many-labels');
  try {
    const lists = await showList(f.workbench, f.projectId);
    assert.deepEqual(lists.issues.loaded?.labels, manyLabels);
    const pulls = await showList(f.workbench, f.projectId, 'pullRequests');
    assert.deepEqual(pulls.pullRequests.loaded?.labels, manyLabels);
  } finally {
    await f.close();
  }
});

test('Load more reads no later label page and keeps every label, and a refresh reads them again with its first page', async context => {
  const double = await ghDouble(context, { ...forgeAccount, labels: manyLabels, issues: thirtyIssues });
  const f = await boundWorkbench('issue-many-labels-load-more');
  const labelPageReads = (calls: string[][]) =>
    calls.filter(args => args.some(arg => arg.startsWith('query=')) && !args.some(arg => arg.startsWith('search=')))
      .length;
  try {
    await showList(f.workbench, f.projectId);
    await double.calls();
    const more = await shownLists(f.workbench, f.projectId, () => f.workbench.forgeSidebar.loadMore(f.projectId));
    assert.deepEqual(
      [more.issues.loaded?.items.length, more.issues.loaded?.labels, labelPageReads(await double.calls())],
      [30, manyLabels, 0],
      'Load more reads no label page',
    );
    const refreshed = await refreshList(f.workbench, f.projectId);
    assert.deepEqual(
      [refreshed.issues.loaded?.labels, labelPageReads(await double.calls())],
      [manyLabels, 2],
      'a refresh reads the later label pages once, with its first page',
    );
  } finally {
    await f.close();
  }
});

test('a later label page that fails fails the list read', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    labels: manyLabels,
    issues: thirtyIssues,
    labelPageFailure: { code: 1, stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' },
  });
  const f = await boundWorkbench('issue-label-page-failure');
  try {
    const failed = (await showList(f.workbench, f.projectId)).issues.failed;
    assert.deepEqual(
      [failed?.failure.kind, failed?.failure.detail],
      ['transient', 'HTTP 502: Bad Gateway (https://api.github.com/graphql)'],
    );
  } finally {
    await f.close();
  }
});
