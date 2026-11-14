import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhIssue } from './support/gh-double';
import type { ListFilter } from '../app/shared/forge';
import { boundWorkbench, day, forgeAccount, openNoFilter } from './support/bound-workbench';

/** 30 open issues, #1 the oldest, created a day apart. */
const thirtyIssues: GhIssue[] = Array.from({ length: 30 }, (_, index) => ({
  number: index + 1, title: `Issue ${index + 1}`, state: 'OPEN', createdAt: day(index), labels: [],
}));


test('a refresh returns one page of 25 issues, newest first, and the cursor loads the rest', async context => {
  await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('issue-page');
  try {
    const first = await f.workbench.issuePage(f.projectId, { filter: openNoFilter, cursor: null });
    assert.ok(first.ok);
    assert.deepEqual(first.items.map(issue => issue.number), Array.from({ length: 25 }, (_, index) => 30 - index));
    assert.deepEqual(first.items[0], { number: 30, title: 'Issue 30', state: 'open', closedAs: null, createdAt: day(29), labels: [],
      blockedBy: [], unlistedBlockers: 0, parent: null, subIssues: { closed: 0, total: 0, issues: [] } });
    assert.ok(first.cursor);
    const rest = await f.workbench.issuePage(f.projectId, { filter: openNoFilter, cursor: first.cursor });
    assert.ok(rest.ok);
    assert.deepEqual(rest.items.map(issue => issue.number), [5, 4, 3, 2, 1]);
    assert.equal(rest.cursor, null, 'the last page has no cursor');
  } finally { await f.close(); }
});

test('the search, open or closed state and labels all narrow the page, and a closed issue says how it was closed', async context => {
  const bug = { name: 'bug', color: 'd73a4a' }, ui = { name: 'good first issue', color: '7057ff' };
  await ghDouble(context, { ...forgeAccount, labels: [bug, ui], issues: [
    { number: 1, title: 'Sidebar refresh spins forever', state: 'OPEN', createdAt: day(1), labels: [bug, ui] },
    { number: 2, title: 'Sidebar width', state: 'OPEN', createdAt: day(2), labels: [bug] },
    { number: 3, title: 'Dispatch menu', state: 'CLOSED', stateReason: 'NOT_PLANNED', createdAt: day(3), labels: [ui] },
    { number: 12, title: 'Tray order', state: 'OPEN', createdAt: day(4), labels: [] },
  ] });
  const f = await boundWorkbench('issue-filters');
  try {
    const numbers = async (filter: Partial<ListFilter>) => {
      const page = await f.workbench.issuePage(f.projectId, { filter: { ...openNoFilter, ...filter }, cursor: null });
      assert.ok(page.ok);
      return page.items.map(issue => issue.number);
    };
    assert.deepEqual(await numbers({}), [12, 2, 1]);
    assert.deepEqual(await numbers({ search: 'sidebar' }), [2, 1], 'words match titles');
    assert.deepEqual(await numbers({ search: '#12' }), [12], 'a number matches the issue number');
    assert.deepEqual(await numbers({ search: '12' }), [12]);
    assert.deepEqual(await numbers({ labels: ['bug', 'good first issue'] }), [1], 'every chosen label must be present');
    assert.deepEqual(await numbers({ state: 'closed' }), [3]);
    const closed = await f.workbench.issuePage(f.projectId, { filter: { ...openNoFilter, state: 'closed' }, cursor: null });
    assert.ok(closed.ok);
    assert.deepEqual(closed.items[0], { number: 3, title: 'Dispatch menu', state: 'closed', closedAs: 'notPlanned', createdAt: day(3), labels: [ui],
      blockedBy: [], unlistedBlockers: 0, parent: null, subIssues: { closed: 0, total: 0, issues: [] } });
    assert.deepEqual(closed.labels, [bug, ui], 'the page carries the labels the repository defines');
    assert.deepEqual(closed.counts, { open: 3, closed: 1 });
    const labelled = await f.workbench.issuePage(f.projectId, { filter: { ...openNoFilter, labels: ['good first issue'] }, cursor: null });
    assert.ok(labelled.ok);
    assert.deepEqual(labelled.counts, { open: 1, closed: 1 }, 'the counts follow the search and labels, not the state');
    assert.equal(closed.cursor, null);
  } finally { await f.close(); }
});

test('a page carries each issue\'s parent, its sub-issues with their progress, and only the open issues blocking it', async context => {
  const bug = { name: 'bug', color: 'd73a4a' };
  await ghDouble(context, { ...forgeAccount, issues: [
    { number: 1, title: 'Map', state: 'OPEN', createdAt: day(1), labels: [] },
    { number: 2, title: 'Done ticket', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: day(2), labels: [], parent: 1 },
    { number: 3, title: 'Blocked ticket', state: 'OPEN', createdAt: day(3), labels: [bug], parent: 1,
      blockedBy: [2, 4, { path: 'octo/other', number: 7, title: 'Upstream fix', state: 'OPEN' }, { path: 'octo/other', number: 8, title: 'Old', state: 'CLOSED' }] },
    { number: 4, title: 'Blocker', state: 'OPEN', createdAt: day(4), labels: [] },
  ] });
  const f = await boundWorkbench('issue-tree');
  try {
    assert.deepEqual(f.workbench.snapshot().projects.find(project => project.id === f.projectId)?.capabilities,
      { subIssues: true, blocking: true, requiredChecks: true, mergeQueue: true, mergeMethods: ['merge', 'squash', 'rebase'] },
      'the project declares the features GitHub has');
    const page = await f.workbench.issuePage(f.projectId, { filter: openNoFilter, cursor: null });
    assert.ok(page.ok);
    const blockers = [{ path: null, number: 4, title: 'Blocker' }, { path: 'octo/other', number: 7, title: 'Upstream fix' }];
    assert.deepEqual(page.items.map(issue => issue.number), [4, 3, 1], 'the page itself stays flat; the list builds the tree');
    assert.deepEqual(page.items[1], { number: 3, title: 'Blocked ticket', state: 'open', closedAs: null, createdAt: day(3), labels: [bug],
      blockedBy: blockers, unlistedBlockers: 0, parent: 1, subIssues: { closed: 0, total: 0, issues: [] } });
    assert.deepEqual(page.items[2].subIssues, { closed: 1, total: 2, issues: [
      { number: 2, title: 'Done ticket', state: 'closed', closedAs: 'completed', createdAt: day(2), labels: [], blockedBy: [], unlistedBlockers: 0 },
      { number: 3, title: 'Blocked ticket', state: 'open', closedAs: null, createdAt: day(3), labels: [bug], blockedBy: blockers, unlistedBlockers: 0 },
    ] });
  } finally { await f.close(); }
});

test('an issue blocked by more issues than GitHub lists counts the open blockers it did not list', async context => {
  const closedBlockers = Array.from({ length: 20 }, (_, index) => ({ path: 'octo/other', number: index + 1, title: `Old ${index + 1}`, state: 'CLOSED' as const }));
  await ghDouble(context, { ...forgeAccount, issues: [
    { number: 1, title: 'Long wait', state: 'OPEN', createdAt: day(1), labels: [],
      blockedBy: [...closedBlockers, { path: 'octo/other', number: 30, title: 'Still open', state: 'OPEN' }, { path: 'octo/other', number: 31, title: 'Also open', state: 'OPEN' }] },
  ] });
  const f = await boundWorkbench('issue-blockers-window');
  try {
    const page = await f.workbench.issuePage(f.projectId, { filter: openNoFilter, cursor: null });
    assert.ok(page.ok);
    assert.deepEqual([page.items[0].blockedBy, page.items[0].unlistedBlockers], [[], 2], 'closed blockers fill the listed window; the open ones are counted');
  } finally { await f.close(); }
});

test('list failures fall into the four kinds with the forge text, and an inaccessible repository names the account', async context => {
  const double = await ghDouble(context, { ...forgeAccount, issues: thirtyIssues });
  const f = await boundWorkbench('issue-failures');
  const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
  const page = () => f.workbench.issuePage(f.projectId, { filter: openNoFilter, cursor: null });
  try {
    await double.set({ account: 'octo', repositories: [] });
    assert.deepEqual(await page(), { ok: false, account: 'octo', failure: { kind: 'inaccessible', forge,
      detail: "GraphQL: Could not resolve to a Repository with the name 'octo/tools'. (repository)" } });
    await double.set({ ...forgeAccount, failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } });
    assert.deepEqual(await page(), { ok: false, account: null, failure: { kind: 'loggedOut', forge, detail: 'To get started with GitHub CLI, please run:  gh auth login' } });
    await double.set({ ...forgeAccount, failure: { code: 1, stderr: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)\n' } });
    assert.deepEqual(await page(), { ok: false, account: null, failure: { kind: 'transient', forge, detail: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' } });
    double.uninstall();
    assert.deepEqual(await page(), { ok: false, account: null, failure: { kind: 'notInstalled', forge, detail: '' } });
  } finally { await f.close(); }
});
