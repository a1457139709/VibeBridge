import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhPullRequest } from './support/gh-double';
import { boundWorkbench, day, forgeAccount } from './support/bound-workbench';

const repositoryUrl = 'https://github.com/octo/tools';
const bug = { name: 'bug', color: 'd73a4a' };
const change = (number: number, extra: Partial<GhPullRequest> = {}): GhPullRequest => ({ number, title: `Change ${number}`, state: 'OPEN', createdAt: day(number), ...extra });

test('a pull request detail carries its branches, labels, the issues it closes on merge, its body, and where its changes are', async context => {
  await ghDouble(context, { ...forgeAccount,
    issues: [
      { number: 3, title: 'Spec', state: 'OPEN', createdAt: day(3), labels: [] },
      { number: 4, title: 'Done already', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: day(4), labels: [] },
    ],
    pullRequests: [change(12, { title: 'Read-only detail', author: 'mona', labels: [bug], head: 'feat/detail', base: 'main', closes: [3, 4],
      bodyHTML: '<p>Closes <a href="https://github.com/octo/tools/issues/3">#3</a>.</p>' })],
  });
  const f = await boundWorkbench('pull-request-detail-head');
  try {
    const result = await f.workbench.pullRequestDetail(f.projectId, 12);
    assert.ok(result.ok);
    const { pullRequest } = result;
    assert.deepEqual({ number: pullRequest.number, title: pullRequest.title, state: pullRequest.state, createdAt: pullRequest.createdAt, author: pullRequest.author,
      labels: pullRequest.labels, url: pullRequest.url, changesUrl: pullRequest.changesUrl, head: pullRequest.head, base: pullRequest.base, body: pullRequest.body,
      closingIssues: pullRequest.closingIssues, links: pullRequest.links }, {
      number: 12, title: 'Read-only detail', state: 'open', createdAt: day(12), author: 'mona', labels: [bug],
      url: `${repositoryUrl}/pull/12`, changesUrl: `${repositoryUrl}/pull/12/files`, head: 'feat/detail', base: 'main',
      body: '<p>Closes <a href="https://github.com/octo/tools/issues/3">#3</a>.</p>',
      closingIssues: [
        { number: 3, title: 'Spec', state: 'open', closedAs: null, url: `${repositoryUrl}/issues/3` },
        { number: 4, title: 'Done already', state: 'closed', closedAs: 'completed', url: `${repositoryUrl}/issues/4` },
      ],
      links: { issues: `${repositoryUrl}/issues/`, pullRequests: `${repositoryUrl}/pull/` },
    });
  } finally { await f.close(); }
});

test('a pull request detail lists comments and review summaries in time order, each review with its verdict, and only counts code comments', async context => {
  await ghDouble(context, { ...forgeAccount, pullRequests: [change(12, {
    comments: [
      { author: 'hubot', createdAt: day(14), bodyHTML: '<p>Rebased.</p>' },
      { author: null, createdAt: day(16), bodyHTML: '<p>From a deleted account.</p>' },
    ],
    reviews: [
      { author: 'mona', state: 'CHANGES_REQUESTED', submittedAt: day(13), bodyHTML: '<p>Handle the draft row.</p>', codeComments: 3 },
      { author: 'carol', state: 'COMMENTED', submittedAt: day(13), bodyHTML: '', codeComments: 2 },
      { author: 'mona', state: 'APPROVED', submittedAt: day(15), bodyHTML: '<p>LGTM</p>' },
      { author: 'bob', state: 'DISMISSED', submittedAt: day(15), bodyHTML: '<p>Outdated.</p>' },
      { author: 'octo', state: 'PENDING', submittedAt: null, bodyHTML: '<p>Not submitted.</p>', codeComments: 4 },
    ],
  })] });
  const f = await boundWorkbench('pull-request-detail-timeline');
  try {
    const result = await f.workbench.pullRequestDetail(f.projectId, 12);
    assert.ok(result.ok);
    assert.deepEqual(result.pullRequest.timeline, [
      { author: 'mona', createdAt: day(13), html: '<p>Handle the draft row.</p>', verdict: 'changesRequested' },
      { author: 'hubot', createdAt: day(14), html: '<p>Rebased.</p>', verdict: null },
      { author: 'mona', createdAt: day(15), html: '<p>LGTM</p>', verdict: 'approved' },
      { author: 'bob', createdAt: day(15), html: '<p>Outdated.</p>', verdict: 'dismissed' },
      { author: null, createdAt: day(16), html: '<p>From a deleted account.</p>', verdict: null },
    ], 'a review without a summary and an unsubmitted review are left out');
    assert.equal(result.pullRequest.commentCount, 2);
    assert.equal(result.pullRequest.codeComments, 5, 'code comments of submitted reviews');
  } finally { await f.close(); }
});

test('a pull request detail says what stands between it and a merge: the review, each check with whether it is required, conflicts, and how the repository merges', async context => {
  await ghDouble(context, { ...forgeAccount, mergeMethods: { merge: false, squash: true, rebase: true }, pullRequests: [
    change(12, { reviewDecision: 'CHANGES_REQUESTED', requiredApprovals: 2, mergeable: 'CONFLICTING', mergeQueue: true, checkRuns: [
      { name: 'unit tests', status: 'COMPLETED', conclusion: 'FAILURE', required: true },
      { name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', required: true },
      { name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'timeout', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
      { context: 'ci/legacy', state: 'PENDING', targetUrl: 'https://ci.example/legacy', required: true },
      { context: 'ci/old', state: 'ERROR', targetUrl: null },
    ] }),
    change(13, { reviewDecision: 'APPROVED', mergeable: 'MERGEABLE' }),
    change(14, { reviewDecision: 'REVIEW_REQUIRED', requiredApprovals: null, mergeable: 'UNKNOWN' }),
    change(15, { reviewDecision: null, mergeable: 'MERGEABLE' }),
  ] });
  const f = await boundWorkbench('pull-request-detail-merge');
  const detail = async (number: number) => {
    const result = await f.workbench.pullRequestDetail(f.projectId, number);
    assert.ok(result.ok);
    return result.pullRequest;
  };
  try {
    const blocked = await detail(12);
    const run = (number: number) => `${repositoryUrl}/runs/${number}`;
    assert.deepEqual(blocked.checks, [
      { name: 'unit tests', result: 'failed', required: true, url: run(0) },
      { name: 'e2e', result: 'pending', required: false, url: run(1) },
      { name: 'lint', result: 'passed', required: true, url: run(2) },
      { name: 'docs', result: 'skipped', required: false, url: run(3) },
      { name: 'timeout', result: 'failed', required: false, url: run(4) },
      { name: 'ci/legacy', result: 'pending', required: true, url: 'https://ci.example/legacy' },
      { name: 'ci/old', result: 'failed', required: false, url: null },
    ]);
    assert.deepEqual([blocked.review, blocked.conflicts, blocked.merge], [{ state: 'changesRequested', requiredApprovals: 2 }, 'conflicting', { methods: ['squash', 'rebase'], queue: true }]);
    const ready = await detail(13);
    assert.deepEqual([ready.review, ready.conflicts, ready.checks, ready.merge.queue], [{ state: 'approved', requiredApprovals: null }, 'none', [], false]);
    const waiting = await detail(14);
    assert.deepEqual([waiting.review, waiting.conflicts], [{ state: 'required', requiredApprovals: null }, 'unknown']);
    assert.deepEqual((await detail(15)).review, { state: 'notRequired', requiredApprovals: null });
  } finally { await f.close(); }
});

test('a missing pull request and forge CLI failures come back as forge failures with the forge text', async context => {
  const double = await ghDouble(context, { ...forgeAccount, pullRequests: [change(1)] });
  const f = await boundWorkbench('pull-request-detail-failures');
  const detail = (number: number) => f.workbench.pullRequestDetail(f.projectId, number);
  try {
    const missing = await detail(99);
    assert.ok(!missing.ok);
    assert.deepEqual([missing.failure.kind, missing.failure.detail], ['inaccessible', 'GraphQL: Could not resolve to a PullRequest with the number of 99. (repository.pullRequest)']);
    await double.set({ ...forgeAccount, failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' } });
    const loggedOut = await detail(1);
    assert.ok(!loggedOut.ok);
    assert.equal(loggedOut.failure.kind, 'loggedOut');
    await assert.rejects(f.workbench.pullRequestDetail(f.projectId, 0), 'only a positive number is asked for');
  } finally { await f.close(); }
});
