import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { defaultListFilter, type ListFilter, type MergeRequestPageResult } from '../app/shared/code-hosting';
import { testDirectory } from './support/directory';
import { ghDouble, type GhPullRequest, type GhState } from './support/gh-double';

/** Pull request #1 … #count, created one day apart so a higher number is newer; even numbers are merged. */
function pullRequests(count: number): GhPullRequest[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return { number, title: `Change ${number}`, state: number % 2 ? 'OPEN' : 'MERGED', isDraft: false, author: 'mona',
      createdAt: new Date(Date.UTC(2026, 0, 1) + number * 86400000).toISOString(), labels: [], checks: 'SUCCESS' };
  });
}

/** A Workbench whose one project is bound to octo/app on the gh double. */
async function boundProject(context: TestContext, scope: string, state: GhState) {
  const gh = await ghDouble(context, { login: 'octo', repositories: ['octo/app'], ...state });
  const directory = await testDirectory(context, scope);
  const workbench = await Workbench.open(directory);
  context.after(() => workbench.quit());
  const agents = workbench.snapshot().settings.agents;
  agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
  await workbench.saveSettings({ agents });
  const { project } = await workbench.createProject({ name: 'Bound', directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
  await workbench.bindRepository(project.id, { platform: 'github', path: 'octo/app' });
  const page = (filter: Partial<ListFilter> = {}, cursor: string | null = null) =>
    workbench.mergeRequestPage(project.id, { ...defaultListFilter, ...filter }, cursor);
  return { gh, workbench, project, page };
}

function numbers(result: MergeRequestPageResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.page.mergeRequests.map(request => request.number);
}

test('a merge request list page holds the 25 newest matching merge requests and the cursor loads the rest', async context => {
  const f = await boundProject(context, 'merge-request-list-pages', { pullRequests: pullRequests(60).map(request => ({ ...request, state: 'OPEN' })),
    issues: [{ number: 61, title: 'An issue, not a merge request', state: 'OPEN', stateReason: null, createdAt: '2026-06-01T00:00:00Z', labels: [] }] });
  const first = await f.page();
  assert.deepEqual(numbers(first), Array.from({ length: 25 }, (_, index) => 60 - index));
  assert.ok(first.ok && first.page.next);
  const second = await f.page({}, first.page.next);
  assert.deepEqual(numbers(second), Array.from({ length: 25 }, (_, index) => 35 - index));
  assert.ok(second.ok && second.page.next);
  const third = await f.page({}, second.page.next);
  assert.deepEqual(numbers(third), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.ok(third.ok);
  assert.equal(third.page.next, null);
  assert.deepEqual(first.page.mergeRequests[0], { number: 60, title: 'Change 60', state: 'open', draft: false, author: 'mona',
    createdAt: '2026-03-02T00:00:00.000Z', checks: 'passing', labels: [], url: 'https://github.com/octo/app/pull/60' });
});

test('a merge request shows its state, draft, author, check conclusion and labels', async context => {
  const f = await boundProject(context, 'merge-request-list-shapes', { labels: [{ name: 'bug', color: 'd73a4a' }], pullRequests: [
    { number: 1, title: 'Failing', state: 'OPEN', isDraft: false, author: 'mona', createdAt: '2026-01-01T00:00:00Z', labels: ['bug'], checks: 'FAILURE' },
    { number: 2, title: 'Errored', state: 'OPEN', isDraft: false, author: 'mona', createdAt: '2026-01-02T00:00:00Z', labels: [], checks: 'ERROR' },
    { number: 3, title: 'Running', state: 'OPEN', isDraft: true, author: 'hubot', createdAt: '2026-01-03T00:00:00Z', labels: [], checks: 'PENDING' },
    { number: 4, title: 'Unchecked', state: 'OPEN', isDraft: false, author: null, createdAt: '2026-01-04T00:00:00Z', labels: [], checks: null },
  ] });
  const result = await f.page();
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.page.mergeRequests.map(({ number, draft, author, checks, labels }) => ({ number, draft, author, checks, labels })), [
    { number: 4, draft: false, author: null, checks: null, labels: [] },
    { number: 3, draft: true, author: 'hubot', checks: 'pending', labels: [] },
    { number: 2, draft: false, author: 'mona', checks: 'failing', labels: [] },
    { number: 1, draft: false, author: 'mona', checks: 'failing', labels: [{ name: 'bug', color: 'd73a4a' }] },
  ]);
  assert.deepEqual(result.page.labels, [{ name: 'bug', color: 'd73a4a' }]);
});

test('the closed merge request list includes merged ones, and search and labels filter on the platform', async context => {
  const f = await boundProject(context, 'merge-request-list-filters', { pullRequests: [
    { number: 1, title: 'Fix crash', state: 'MERGED', isDraft: false, author: 'mona', createdAt: '2026-01-01T00:00:00Z', labels: ['bug'], checks: 'SUCCESS' },
    { number: 2, title: 'Fix typo', state: 'CLOSED', isDraft: false, author: 'mona', createdAt: '2026-01-02T00:00:00Z', labels: [], checks: null },
    { number: 3, title: 'Add theme', state: 'OPEN', isDraft: false, author: 'mona', createdAt: '2026-01-03T00:00:00Z', labels: ['bug'], checks: null },
    { number: 14, title: 'Docs', state: 'OPEN', isDraft: false, author: 'mona', createdAt: '2026-01-04T00:00:00Z', labels: [], checks: null },
  ], issues: [{ number: 5, title: 'Fix the issue', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: '2026-01-05T00:00:00Z', labels: [] }] });
  const closed = await f.page({ state: 'closed' });
  assert.deepEqual(numbers(closed), [2, 1]);
  assert.ok(closed.ok);
  assert.deepEqual(closed.page.mergeRequests.map(request => request.state), ['closed', 'merged']);
  assert.deepEqual(numbers(await f.page({ state: 'closed', search: 'crash' })), [1]);
  assert.deepEqual(numbers(await f.page({ labels: ['bug'] })), [3]);
  assert.deepEqual(numbers(await f.page({ search: '#14' })), [14]);
  assert.deepEqual(numbers(await f.page({ search: '1', state: 'closed' })), [1], 'a merged number belongs to the closed list');
  assert.deepEqual(numbers(await f.page({ search: '5', state: 'closed' })), [], 'an issue number is not a merge request');
});

test('merge request list failures are told apart like the issue list', async context => {
  const f = await boundProject(context, 'merge-request-list-failures', { pullRequests: pullRequests(3) });
  await f.gh.set({ login: 'octo', repositories: [] });
  const unreachable = await f.page();
  assert.ok(!unreachable.ok);
  assert.equal(unreachable.failure.kind, 'unreachable');
  assert.equal(unreachable.account, 'octo');
  await f.gh.set({ failure: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' } });
  const signedOut = await f.page();
  assert.ok(!signedOut.ok);
  assert.equal(signedOut.failure.kind, 'signedOut');
  await f.gh.uninstall();
  const missing = await f.page();
  assert.ok(!missing.ok);
  assert.equal(missing.failure.kind, 'notInstalled');
  await f.workbench.bindRepository(f.project.id, null);
  await assert.rejects(f.page(), /repositoryUnbound/);
});
