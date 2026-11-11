import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { MergeRequestDetailResult } from '../app/shared/code-hosting';
import { testDirectory } from './support/directory';
import { ghDouble, type GhIssue, type GhPullRequest, type GhState } from './support/gh-double';

const issue = (number: number, extra: Partial<GhIssue> = {}): GhIssue => ({ number, title: `Issue ${number}`, state: 'OPEN', stateReason: null,
  createdAt: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`, labels: [], ...extra });
const pullRequest = (number: number, extra: Partial<GhPullRequest> = {}): GhPullRequest => ({ number, title: `Change ${number}`, state: 'OPEN', isDraft: false,
  author: 'mona', createdAt: '2026-01-10T00:00:00Z', labels: [], checks: null, ...extra });

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
  return { gh, workbench, detail: (number: number) => workbench.mergeRequestDetail(project.id, number), project };
}

function detail(result: MergeRequestDetailResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.mergeRequest;
}

test('a merge request detail holds its branches, body, comments, review summaries and the issues it closes', async context => {
  const f = await boundProject(context, 'merge-request-detail', {
    commentPageSize: 1,
    labels: [{ name: 'bug', color: 'd73a4a' }],
    issues: [issue(1, { title: 'Broken' }), issue(2, { state: 'CLOSED', stateReason: 'COMPLETED' })],
    pullRequests: [pullRequest(10, {
      title: 'Fix it', labels: ['bug'], headRefName: 'fix-it', baseRefName: 'main', bodyHTML: '<p>Fixes #1</p>', closes: [1, 2],
      comments: [1, 3].map(day => ({ author: 'hubot', createdAt: `2026-02-0${day}T00:00:00Z`, bodyHTML: `<p>Comment ${day}</p>` })),
      reviews: [
        { author: 'octo', state: 'CHANGES_REQUESTED', submittedAt: '2026-02-02T00:00:00Z', bodyHTML: '<p>Please rename</p>', codeComments: 2 },
        { author: 'octo', state: 'PENDING', submittedAt: null, bodyHTML: '', codeComments: 1 },
        { author: 'hubot', state: 'APPROVED', submittedAt: '2026-02-04T00:00:00Z', bodyHTML: '', codeComments: 0 },
      ],
    }), pullRequest(11, { headOwner: 'fork', headRefName: 'patch-1', baseRefName: 'main' })],
  });
  const shown = detail(await f.detail(10));
  const { merge: _merge, ...conversation } = shown;
  assert.deepEqual(conversation, {
    number: 10, title: 'Fix it', state: 'open', draft: false, author: 'mona', createdAt: '2026-01-10T00:00:00Z',
    labels: [{ name: 'bug', color: 'd73a4a' }], url: 'https://github.com/octo/app/pull/10', changesUrl: 'https://github.com/octo/app/pull/10/files',
    head: 'fix-it', base: 'main', body: '<p>Fixes #1</p>',
    comments: [1, 3].map(day => ({ author: 'hubot', createdAt: `2026-02-0${day}T00:00:00Z`, body: `<p>Comment ${day}</p>` })),
    reviews: [
      { author: 'octo', state: 'changesRequested', submittedAt: '2026-02-02T00:00:00Z', body: '<p>Please rename</p>', codeComments: 2,
        url: 'https://github.com/octo/app/pull/10#pullrequestreview-1' },
      { author: 'hubot', state: 'approved', submittedAt: '2026-02-04T00:00:00Z', body: '', codeComments: 0,
        url: 'https://github.com/octo/app/pull/10#pullrequestreview-3' },
    ],
    closingIssues: [
      { number: 1, title: 'Broken', state: 'open', closedAs: null, repository: 'octo/app', url: 'https://github.com/octo/app/issues/1' },
      { number: 2, title: 'Issue 2', state: 'closed', closedAs: 'completed', repository: 'octo/app', url: 'https://github.com/octo/app/issues/2' },
    ],
  });
  assert.equal(detail(await f.detail(11)).head, 'fork:patch-1', 'a head branch in another repository names its owner');
});

test('the merge state holds the review decision, every check with whether it is required, conflicts, merge methods and the merge queue', async context => {
  const f = await boundProject(context, 'merge-request-merge-state', {
    mergeMethods: { merge: false, squash: true, rebase: true },
    pullRequests: [pullRequest(10, {
      reviewDecision: 'REVIEW_REQUIRED', mergeable: 'CONFLICTING', mergeQueue: true,
      checkContexts: [
        { kind: 'run', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', required: true, url: 'https://ci.example/build' },
        { kind: 'run', name: 'lint', status: 'IN_PROGRESS', conclusion: null, required: false, url: 'https://ci.example/lint' },
        { kind: 'run', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED', required: false, url: null },
        { kind: 'status', name: 'deploy', state: 'SUCCESS', required: true, url: 'https://ci.example/deploy' },
        { kind: 'status', name: 'license', state: 'EXPECTED', required: true, url: null },
      ],
    }), pullRequest(11, { reviewDecision: null, mergeable: 'UNKNOWN' })],
  });
  assert.deepEqual(detail(await f.detail(10)).merge, {
    review: 'reviewRequired',
    checks: [
      { name: 'build', conclusion: 'failing', required: true, url: 'https://ci.example/build' },
      { name: 'lint', conclusion: 'pending', required: false, url: 'https://ci.example/lint' },
      { name: 'docs', conclusion: 'passing', required: false, url: null },
      { name: 'deploy', conclusion: 'passing', required: true, url: 'https://ci.example/deploy' },
      { name: 'license', conclusion: 'pending', required: true, url: null },
    ],
    conflicting: true, methods: ['squash', 'rebase'], queue: true,
  });
  assert.deepEqual(detail(await f.detail(11)).merge, { review: null, checks: [], conflicting: false, methods: ['squash', 'rebase'], queue: false },
    'a mergeability GitHub has not worked out yet is no conflict');
});

test('a merge request detail tells a missing merge request and platform failures apart', async context => {
  const f = await boundProject(context, 'merge-request-detail-failures', { issues: [issue(1)], pullRequests: [pullRequest(10)] });
  const missing = await f.detail(99);
  assert.ok(!missing.ok && missing.failure.kind === 'unreachable', JSON.stringify(missing));
  const anIssue = await f.detail(1);
  assert.ok(!anIssue.ok && anIssue.failure.kind === 'unreachable', 'an issue number is no merge request');
  await f.gh.set({ failure: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' } });
  const signedOut = await f.detail(10);
  assert.ok(!signedOut.ok && signedOut.failure.kind === 'signedOut', JSON.stringify(signedOut));
  await assert.rejects(f.detail(0), /issueNumberInvalid/);
  await f.workbench.bindRepository(f.project.id, null);
  await assert.rejects(f.detail(10), /repositoryUnbound/);
});
