import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhIssue } from './support/gh-double';
import { interactiveWorkbench } from './support/interactive-workbench';

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
const account = { account: 'octo', repositories: ['octo/tools'] };
const issueUrl = (n: number) => `https://github.com/octo/tools/issues/${n}`;
const bug = { name: 'bug', color: 'd73a4a' };
const plain = (number: number, extra: Partial<GhIssue> = {}): GhIssue => ({ number, title: `Issue ${number}`, state: 'OPEN', createdAt: day(number), labels: [], ...extra });

async function boundWorkbench(scope: string) {
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Bound');
  await f.workbench.editProject(project.id, { name: 'Bound', directory: f.directory, repository: { forge: 'github', path: 'octo/tools' } }, false);
  return { ...f, projectId: project.id };
}

test('an issue detail carries the forge-rendered body and comments with their authors, and the assignees and comment count', async context => {
  await ghDouble(context, { ...account, issues: [plain(7, {
    title: 'Issue detail', state: 'CLOSED', stateReason: 'COMPLETED', labels: [bug], author: 'mona', assignees: ['octo', 'hubot'],
    bodyHTML: '<p>Read <a href="https://github.com/octo/tools/issues/3">#3</a> first.</p>',
    comments: [
      { author: 'hubot', createdAt: day(8), bodyHTML: '<p>Resolution: overlay by default.</p>' },
      { author: null, createdAt: day(9), bodyHTML: '<p>From a deleted account.</p>' },
    ],
  })] });
  const f = await boundWorkbench('issue-detail-body');
  try {
    const result = await f.workbench.issueDetail(f.projectId, 7);
    assert.ok(result.ok);
    const { issue } = result;
    assert.deepEqual({ ...issue, parent: undefined, subIssues: undefined, blockedBy: undefined, blocking: undefined, closingPullRequests: undefined }, {
      number: 7, title: 'Issue detail', state: 'closed', closedAs: 'completed', createdAt: day(7), labels: [bug],
      url: issueUrl(7), author: 'mona', assignees: ['octo', 'hubot'],
      body: '<p>Read <a href="https://github.com/octo/tools/issues/3">#3</a> first.</p>',
      comments: [
        { author: 'hubot', createdAt: day(8), html: '<p>Resolution: overlay by default.</p>' },
        { author: null, createdAt: day(9), html: '<p>From a deleted account.</p>' },
      ],
      commentCount: 2,
      issueLinks: 'https://github.com/octo/tools/issues/',
      parent: undefined, subIssues: undefined, blockedBy: undefined, blocking: undefined, closingPullRequests: undefined,
    });
  } finally { await f.close(); }
});

test('an issue detail names its parent, its sub-issues in number order, its blockers, what it blocks, and the pull requests that close it', async context => {
  await ghDouble(context, { ...account,
    issues: [
      plain(1, { title: 'Spec' }),
      plain(2, { title: 'Blocker', blockedBy: [] }),
      plain(5, { title: 'Detail', parent: 1, blockedBy: [2, 3], closedBy: [40, 41, 42, 43] }),
      plain(3, { title: 'Closed blocker', state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
      plain(9, { title: 'Later sub-issue', parent: 5 }),
      plain(6, { title: 'Earlier sub-issue', parent: 5, blockedBy: [5] }),
    ],
    pullRequests: [
      { number: 40, title: 'Open with checks', state: 'OPEN', checks: 'SUCCESS' },
      { number: 41, title: 'Draft, checks running', state: 'OPEN', isDraft: true, checks: 'PENDING' },
      { number: 42, title: 'Merged, checks failed', state: 'MERGED', checks: 'ERROR' },
      { number: 43, title: 'Closed without checks', state: 'CLOSED', checks: null },
    ],
  });
  const f = await boundWorkbench('issue-detail-relations');
  try {
    const result = await f.workbench.issueDetail(f.projectId, 5);
    assert.ok(result.ok);
    const ref = (number: number, title: string, closedAs: 'notPlanned' | null = null) =>
      ({ number, title, state: closedAs ? 'closed' : 'open', closedAs, url: issueUrl(number) });
    assert.deepEqual(result.issue.parent, { ...ref(1, 'Spec'), progress: { closed: 0, total: 1 } }, 'the parent carries its own sub-issue progress');
    assert.deepEqual(result.issue.subIssues, [ref(6, 'Earlier sub-issue'), ref(9, 'Later sub-issue')]);
    assert.deepEqual(result.issue.blockedBy, [ref(2, 'Blocker'), ref(3, 'Closed blocker', 'notPlanned')]);
    assert.deepEqual(result.issue.blocking, [ref(6, 'Earlier sub-issue')]);
    const pull = (number: number, title: string, state: string, checks: string) => ({ number, title, state, checks, url: `https://github.com/octo/tools/pull/${number}` });
    assert.deepEqual(result.issue.closingPullRequests, [
      pull(40, 'Open with checks', 'open', 'passed'),
      pull(41, 'Draft, checks running', 'draft', 'pending'),
      pull(42, 'Merged, checks failed', 'merged', 'failed'),
      pull(43, 'Closed without checks', 'closed', 'none'),
    ]);
    const root = await f.workbench.issueDetail(f.projectId, 1);
    assert.ok(root.ok);
    assert.equal(root.issue.parent, null);
    assert.deepEqual(root.issue.closingPullRequests, []);
  } finally { await f.close(); }
});

test('a missing issue and forge CLI failures come back as forge failures with the forge text', async context => {
  const double = await ghDouble(context, { ...account, issues: [plain(1)] });
  const f = await boundWorkbench('issue-detail-failures');
  const detail = (number: number) => f.workbench.issueDetail(f.projectId, number);
  try {
    const missing = await detail(99);
    assert.ok(!missing.ok);
    assert.deepEqual([missing.failure.kind, missing.failure.detail], ['inaccessible', 'GraphQL: Could not resolve to an Issue with the number of 99. (repository.issue)']);
    await double.set({ ...account, failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } });
    const loggedOut = await detail(1);
    assert.ok(!loggedOut.ok);
    assert.equal(loggedOut.failure.kind, 'loggedOut');
    double.uninstall();
    const missingCli = await detail(1);
    assert.ok(!missingCli.ok);
    assert.equal(missingCli.failure.kind, 'notInstalled');
    await assert.rejects(f.workbench.issueDetail(f.projectId, 0), 'only a positive issue number is asked for');
  } finally { await f.close(); }
});
