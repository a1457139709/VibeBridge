import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { defaultListFilter, type ListFilter, type IssuePageResult } from '../app/shared/code-hosting';
import { testDirectory } from './support/directory';
import { ghDouble, type GhIssue, type GhState } from './support/gh-double';

/** Issue #1 … #count, created one day apart so a higher number is newer; even numbers are closed. */
function issues(count: number): GhIssue[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return { number, title: `Issue ${number}`, state: number % 2 ? 'OPEN' : 'CLOSED', stateReason: number % 2 ? null : 'COMPLETED',
      createdAt: new Date(Date.UTC(2026, 0, 1) + number * 86400000).toISOString(), labels: [] };
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
  const page = (filter: Partial<ListFilter> = {}, cursor: string | null = null) => workbench.issuePage(project.id, { ...defaultListFilter, ...filter }, cursor);
  return { gh, workbench, project, page };
}

function numbers(result: IssuePageResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.page.issues.map(issue => issue.number);
}

test('an issue list page holds the 25 newest matching issues and the cursor loads the rest', async context => {
  const f = await boundProject(context, 'issue-list-pages', { issues: issues(60) });
  const first = await f.page();
  assert.deepEqual(numbers(first), Array.from({ length: 25 }, (_, index) => 59 - index * 2));
  assert.ok(first.ok && first.page.next);
  const second = await f.page({}, first.page.next);
  assert.deepEqual(numbers(second), [9, 7, 5, 3, 1]);
  assert.ok(second.ok);
  assert.equal(second.page.next, null);
  assert.deepEqual(first.page.issues[0], { number: 59, title: 'Issue 59', state: 'open', closedAs: null,
    createdAt: '2026-03-01T00:00:00.000Z', labels: [], url: 'https://github.com/octo/app/issues/59', parent: null, subIssues: null, blockedBy: [] });
});

test('the issue list filters by state, by every chosen label and by title or number on the platform', async context => {
  const labelled: GhIssue[] = [
    { number: 1, title: 'Crash on start', state: 'OPEN', stateReason: null, createdAt: '2026-01-01T00:00:00Z', labels: ['bug'] },
    { number: 2, title: 'Crash on quit', state: 'OPEN', stateReason: null, createdAt: '2026-01-02T00:00:00Z', labels: ['bug', 'urgent'] },
    { number: 3, title: 'Dark theme', state: 'CLOSED', stateReason: 'NOT_PLANNED', createdAt: '2026-01-03T00:00:00Z', labels: ['urgent'] },
    { number: 12, title: 'Docs', state: 'OPEN', stateReason: null, createdAt: '2026-01-04T00:00:00Z', labels: [] },
  ];
  const f = await boundProject(context, 'issue-list-filters', { issues: labelled,
    labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'urgent', color: 'b60205' }] });
  const all = await f.page();
  assert.deepEqual(numbers(all), [12, 2, 1]);
  assert.ok(all.ok);
  assert.deepEqual(all.page.labels, [{ name: 'bug', color: 'd73a4a' }, { name: 'urgent', color: 'b60205' }]);
  assert.deepEqual(all.page.issues[1].labels, [{ name: 'bug', color: 'd73a4a' }, { name: 'urgent', color: 'b60205' }]);
  const closed = await f.page({ state: 'closed' });
  assert.deepEqual(numbers(closed), [3]);
  assert.ok(closed.ok);
  assert.equal(closed.page.issues[0].closedAs, 'notPlanned');
  assert.deepEqual(numbers(await f.page({ labels: ['bug', 'urgent'] })), [2]);
  assert.deepEqual(numbers(await f.page({ search: 'crash' })), [2, 1]);
  assert.deepEqual(numbers(await f.page({ search: '#12' })), [12]);
  assert.deepEqual(numbers(await f.page({ search: '3' })), [], 'a number that is closed stays out of the open list');
  assert.deepEqual(numbers(await f.page({ search: '99' })), []);
});

test('issue list failures are told apart: CLI missing, signed out, repository unreachable and transient', async context => {
  const f = await boundProject(context, 'issue-list-failures', { issues: issues(3) });
  const failure = async () => {
    const result = await f.page();
    assert.equal(result.ok, false, JSON.stringify(result));
    return result as Extract<IssuePageResult, { ok: false }>;
  };

  await f.gh.set({ login: 'octo', repositories: [], issues: issues(3) });
  const unreachable = await failure();
  assert.equal(unreachable.failure.kind, 'unreachable');
  assert.equal(unreachable.account, 'octo');

  await f.gh.set({ failure: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' } });
  const signedOut = await failure();
  assert.equal(signedOut.failure.kind, 'signedOut');
  assert.equal(signedOut.failure.platform.signInCommand, 'gh auth login');

  await f.gh.set({ failure: { exit: 1, stderr: 'HTTP 403: API rate limit exceeded' } });
  const transient = await failure();
  assert.equal(transient.failure.kind, 'transient');
  assert.match(transient.failure.output, /API rate limit exceeded/);

  await f.gh.uninstall();
  const missing = await failure();
  assert.equal(missing.failure.kind, 'notInstalled');
  assert.equal(missing.failure.platform.installUrl, 'https://cli.github.com');
});

test('an unbound project has no issue list', async context => {
  const f = await boundProject(context, 'issue-list-unbound', { issues: issues(3) });
  await f.workbench.bindRepository(f.project.id, null);
  await assert.rejects(f.page(), /repositoryUnbound/);
});

test('the issue list reads parents, sub-issues with their progress and open native blockers from the platform', async context => {
  const day = (n: number) => `2026-01-0${n}T00:00:00Z`;
  const f = await boundProject(context, 'issue-list-relations', { issues: [
    { number: 1, title: 'Epic', state: 'OPEN', stateReason: null, createdAt: day(1), labels: [] },
    { number: 2, title: 'Child A', state: 'OPEN', stateReason: null, createdAt: day(2), labels: [], parent: 1, blockedBy: [5, 6] },
    { number: 3, title: 'Child B', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: day(3), labels: [], parent: 1 },
    { number: 5, title: 'Blocker', state: 'OPEN', stateReason: null, createdAt: day(5), labels: [] },
    { number: 6, title: 'Done blocker', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: day(6), labels: [] },
    { number: 7, title: 'Orphan', state: 'OPEN', stateReason: null, createdAt: day(7), labels: [], parent: 6 },
  ] });
  const result = await f.page();
  assert.deepEqual(numbers(result), [7, 5, 2, 1]);
  assert.ok(result.ok);
  const [orphan, blocker, child, epic] = result.page.issues;
  assert.equal(orphan.parent, 6);
  assert.deepEqual([blocker.parent, blocker.subIssues, blocker.blockedBy], [null, null, []]);
  assert.deepEqual([child.parent, child.blockedBy], [1, [{ number: 5, title: 'Blocker' }]], 'a closed blocker no longer blocks');
  assert.ok(epic.subIssues);
  assert.deepEqual([epic.subIssues.completed, epic.subIssues.total], [1, 2]);
  assert.deepEqual(epic.subIssues.issues.map(issue => [issue.number, issue.state, issue.parent, issue.blockedBy]),
    [[2, 'open', 1, [{ number: 5, title: 'Blocker' }]], [3, 'closed', 1, []]]);
});
