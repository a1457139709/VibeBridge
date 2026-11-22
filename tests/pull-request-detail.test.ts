import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhPullRequest } from './support/gh-double';
import { boundWorkbench, day, forgeAccount, pullRequestDetail } from './support/bound-workbench';

const repositoryUrl = 'https://github.com/octo/tools';
const bug = { name: 'bug', color: 'd73a4a' };
const change = (number: number, extra: Partial<GhPullRequest> = {}): GhPullRequest => ({
  number,
  title: `Change ${number}`,
  state: 'OPEN',
  createdAt: day(number),
  ...extra,
});

test('a pull request detail carries its branches, labels, the issues it closes on merge, its body, and where its changes are', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    issues: [
      { number: 3, title: 'Spec', state: 'OPEN', createdAt: day(3), labels: [] },
      { number: 4, title: 'Done already', state: 'CLOSED', stateReason: 'COMPLETED', createdAt: day(4), labels: [] },
    ],
    pullRequests: [
      change(12, {
        title: 'Read-only detail',
        author: 'mona',
        labels: [bug],
        head: 'feat/detail',
        base: 'main',
        closes: [3, 4],
        bodyHTML: '<p>Closes <a href="https://github.com/octo/tools/issues/3">#3</a>.</p>',
      }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-head');
  try {
    const result = await pullRequestDetail(f.workbench, f.projectId, 12);
    assert.ok(result.ok);
    const { pullRequest } = result;
    assert.deepEqual(
      {
        number: pullRequest.number,
        title: pullRequest.title,
        state: pullRequest.state,
        createdAt: pullRequest.createdAt,
        author: pullRequest.author,
        labels: pullRequest.labels,
        url: pullRequest.url,
        changesUrl: pullRequest.changesUrl,
        head: pullRequest.head,
        base: pullRequest.base,
        body: pullRequest.body,
        closingIssues: pullRequest.closingIssues,
        links: pullRequest.links,
      },
      {
        number: 12,
        title: 'Read-only detail',
        state: 'open',
        createdAt: day(12),
        author: 'mona',
        labels: [bug],
        url: `${repositoryUrl}/pull/12`,
        changesUrl: `${repositoryUrl}/pull/12/files`,
        head: 'feat/detail',
        base: 'main',
        body: '<p>Closes <a href="https://github.com/octo/tools/issues/3">#3</a>.</p>',
        closingIssues: [
          { number: 3, title: 'Spec', state: 'open', closedAs: null, url: `${repositoryUrl}/issues/3` },
          {
            number: 4,
            title: 'Done already',
            state: 'closed',
            closedAs: 'completed',
            url: `${repositoryUrl}/issues/4`,
          },
        ],
        links: { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` },
      },
    );
  } finally {
    await f.close();
  }
});

test('a pull request timeline holds comments and review summaries in time order, each review with its verdict', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    pullRequests: [
      change(12, {
        comments: [
          { author: 'hubot', createdAt: day(14), bodyHTML: '<p>Rebased.</p>' },
          { author: null, createdAt: day(16), bodyHTML: '<p>From a deleted account.</p>' },
        ],
        reviews: [
          {
            author: 'mona',
            state: 'CHANGES_REQUESTED',
            submittedAt: day(13),
            bodyHTML: '<p>Handle the draft row.</p>',
          },
          { author: 'carol', state: 'COMMENTED', submittedAt: day(13), bodyHTML: '' },
          { author: 'mona', state: 'APPROVED', submittedAt: day(15), bodyHTML: '<p>LGTM</p>' },
          { author: 'bob', state: 'DISMISSED', submittedAt: day(15), bodyHTML: '<p>Outdated.</p>' },
          {
            author: 'octo',
            state: 'PENDING',
            createdAt: day(14),
            submittedAt: null,
            bodyHTML: '<p>Not submitted.</p>',
          },
        ],
      }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-timeline');
  try {
    const result = await pullRequestDetail(f.workbench, f.projectId, 12);
    assert.ok(result.ok);
    assert.deepEqual(
      result.pullRequest.timeline,
      [
        { author: 'mona', createdAt: day(13), html: '<p>Handle the draft row.</p>', verdict: 'changesRequested' },
        { author: 'hubot', createdAt: day(14), html: '<p>Rebased.</p>', verdict: null },
        { author: 'mona', createdAt: day(15), html: '<p>LGTM</p>', verdict: 'approved' },
        { author: 'bob', createdAt: day(15), html: '<p>Outdated.</p>', verdict: 'dismissed' },
        { author: null, createdAt: day(16), html: '<p>From a deleted account.</p>', verdict: null },
      ],
      'a review without a summary and an unsubmitted review are left out',
    );
    assert.equal(result.pullRequest.earlierEntries, 0, 'nothing is older than the timeline');
  } finally {
    await f.close();
  }
});

const minute = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
const comment = (n: number) => ({ author: 'hubot', createdAt: minute(n), bodyHTML: `<p>Comment at ${n}.</p>` });
const review = (n: number, bodyHTML = `<p>Review at ${n}.</p>`) => ({
  author: 'mona',
  state: 'COMMENTED' as const,
  submittedAt: minute(n),
  bodyHTML,
});

test('a long pull request timeline holds the latest 100 comments and reviews, and counts both kinds that came before', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    pullRequests: [
      change(12, {
        comments: Array.from({ length: 150 }, (_, index) => comment(2 * index)),
        reviews: Array.from({ length: 30 }, (_, index) => review(2 * (120 + index) + 1)),
      }),
      change(13, {
        comments: Array.from({ length: 5 }, (_, index) => comment(index + 1)),
        reviews: [review(3), ...Array.from({ length: 100 }, (_, index) => review(50 + index, ''))],
      }),
      change(14, {
        comments: Array.from({ length: 150 }, (_, index) => comment(2 * index)),
        reviews: [
          { author: 'octo', state: 'PENDING', createdAt: minute(1), submittedAt: null, bodyHTML: '<p>Old draft.</p>' },
          { author: 'octo', state: 'PENDING', createdAt: minute(251), submittedAt: null, bodyHTML: '<p>Draft.</p>' },
        ],
      }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-long-timeline');
  const detail = async (number: number) => {
    const result = await pullRequestDetail(f.workbench, f.projectId, number);
    assert.ok(result.ok);
    return result.pullRequest;
  };
  try {
    const long = await detail(12);
    assert.deepEqual(
      [long.timeline.length, long.timeline[0].html, long.timeline.at(-1)?.html, long.earlierEntries],
      [100, '<p>Comment at 160.</p>', '<p>Review at 299.</p>', 80],
    );
    const hidden = await detail(13);
    assert.deepEqual(
      [hidden.timeline, hidden.earlierEntries],
      [[], 6],
      'comments older than the oldest review GitHub returned wait behind the notice with the review it left out',
    );
    const pending = await detail(14);
    assert.deepEqual(
      [pending.timeline.length, pending.timeline[0].html, pending.earlierEntries],
      [100, '<p>Comment at 100.</p>', 51],
      'an unsubmitted review older than the timeline counts among the earlier entries; a newer one does not',
    );
  } finally {
    await f.close();
  }
});

test("a pull request detail carries GitHub's merge state, review decision, and how the repository merges", async context => {
  await ghDouble(context, {
    ...forgeAccount,
    mergeMethods: { merge: false, squash: true, rebase: true },
    pullRequests: [
      change(12, { reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'DIRTY', mergeQueue: true }),
      change(13, { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
      change(14, { reviewDecision: 'REVIEW_REQUIRED', mergeStateStatus: 'UNKNOWN' }),
      change(15, { reviewDecision: null, mergeStateStatus: 'HAS_HOOKS' }),
      change(16, { mergeStateStatus: 'UNSTABLE' }),
      change(17, { mergeStateStatus: 'BEHIND' }),
      change(18, { mergeStateStatus: 'BLOCKED' }),
      change(19, { isDraft: true, mergeStateStatus: 'DRAFT' }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-merge');
  const detail = async (number: number) => {
    const result = await pullRequestDetail(f.workbench, f.projectId, number);
    assert.ok(result.ok);
    const { state, mergeState, reviewDecision, mergeOptions } = result.pullRequest;
    return { state, mergeState, reviewDecision, mergeOptions };
  };
  try {
    assert.deepEqual(await detail(12), {
      state: 'open',
      mergeState: 'dirty',
      reviewDecision: 'changesRequested',
      mergeOptions: { methods: ['squash', 'rebase'], queue: true },
    });
    const merge = async (number: number) => {
      const { mergeState, reviewDecision } = await detail(number);
      return [mergeState, reviewDecision];
    };
    assert.deepEqual(await merge(13), ['clean', 'approved']);
    assert.deepEqual(await merge(14), ['unknown', 'reviewRequired']);
    assert.deepEqual(await merge(15), ['hasHooks', null]);
    assert.deepEqual(await merge(16), ['unstable', null]);
    assert.deepEqual(await merge(17), ['behind', null]);
    assert.deepEqual(await merge(18), ['blocked', null]);
    assert.deepEqual(
      [(await detail(19)).state, (await detail(19)).mergeState],
      ['draft', null],
      'a draft says so through its state alone; the DRAFT merge state GitHub reports for it carries no merge state',
    );
  } finally {
    await f.close();
  }
});

test('a pull request detail lists each check in the order GitHub returns it, with its workflow, raw conclusion, description, whether it is required, its times, and its link', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    pullRequests: [
      change(12, {
        checks: 'FAILURE',
        checkRuns: [
          {
            workflow: 'CI',
            name: 'unit tests',
            status: 'COMPLETED',
            conclusion: 'TIMED_OUT',
            title: 'Timed out after 30 minutes',
            startedAt: '2026-01-02T10:00:00Z',
            completedAt: '2026-01-02T10:30:00Z',
            required: true,
          },
          { workflow: 'CI', name: 'e2e', status: 'IN_PROGRESS', conclusion: null, startedAt: '2026-01-02T10:00:00Z' },
          { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', required: true },
          { workflow: 'Docs', name: 'docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
          { name: 'deploy', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
          {
            context: 'ci/legacy',
            state: 'PENDING',
            targetUrl: 'https://ci.example/legacy',
            description: 'Waiting for a runner',
            required: true,
          },
          { context: 'ci/old', state: 'ERROR', targetUrl: null },
        ],
      }),
      change(13),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-checks');
  const detail = async (number: number) => {
    const result = await pullRequestDetail(f.workbench, f.projectId, number);
    assert.ok(result.ok);
    return result.pullRequest;
  };
  try {
    const run = (number: number) => `${repositoryUrl}/runs/${number}`;
    const none = { workflow: null, description: null, required: false, startedAt: null, completedAt: null };
    assert.deepEqual((await detail(12)).checks, {
      state: { outcome: 'failure', tone: 'failed' },
      counts: [
        { outcome: 'timedOut', tone: 'failed', count: 1 },
        { outcome: 'inProgress', tone: 'pending', count: 1 },
        { outcome: 'success', tone: 'passed', count: 1 },
        { outcome: 'skipped', tone: 'neutral', count: 1 },
        { outcome: 'startupFailure', tone: 'failed', count: 1 },
        { outcome: 'pending', tone: 'pending', count: 1 },
        { outcome: 'error', tone: 'failed', count: 1 },
      ],
      total: 7,
      url: `${repositoryUrl}/pull/12/checks`,
      listed: [
        {
          ...none,
          workflow: 'CI',
          name: 'unit tests',
          outcome: 'timedOut',
          tone: 'failed',
          description: 'Timed out after 30 minutes',
          required: true,
          startedAt: '2026-01-02T10:00:00Z',
          completedAt: '2026-01-02T10:30:00Z',
          url: run(0),
        },
        {
          ...none,
          workflow: 'CI',
          name: 'e2e',
          outcome: 'inProgress',
          tone: 'pending',
          startedAt: '2026-01-02T10:00:00Z',
          url: run(1),
        },
        { ...none, name: 'lint', outcome: 'success', tone: 'passed', required: true, url: run(2) },
        { ...none, workflow: 'Docs', name: 'docs', outcome: 'skipped', tone: 'neutral', url: run(3) },
        { ...none, name: 'deploy', outcome: 'startupFailure', tone: 'failed', url: run(4) },
        {
          ...none,
          name: 'ci/legacy',
          outcome: 'pending',
          tone: 'pending',
          description: 'Waiting for a runner',
          required: true,
          url: 'https://ci.example/legacy',
        },
        { ...none, name: 'ci/old', outcome: 'error', tone: 'failed', url: null },
      ],
    });
    assert.deepEqual((await detail(13)).checks, {
      state: null,
      counts: [],
      total: 0,
      url: `${repositoryUrl}/pull/13/checks`,
      listed: [],
    });
  } finally {
    await f.close();
  }
});

test('a pull request with more than 100 checks lists the first 100 and still counts every one of them by state', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    pullRequests: [
      change(12, {
        checks: 'FAILURE',
        checkRuns: [
          ...Array.from({ length: 110 }, (_, index) => ({
            name: `shard ${index}`,
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          })),
          { name: 'last', status: 'COMPLETED', conclusion: 'FAILURE', required: true },
          ...Array.from({ length: 5 }, (_, index) => ({
            context: `ci/${index}`,
            state: 'SUCCESS' as const,
            targetUrl: null,
          })),
        ],
      }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-many-checks');
  try {
    const result = await pullRequestDetail(f.workbench, f.projectId, 12);
    assert.ok(result.ok);
    const { checks } = result.pullRequest;
    assert.deepEqual(
      [checks.state, checks.counts, checks.total, checks.listed.length, checks.listed.at(-1)?.name],
      [
        { outcome: 'failure', tone: 'failed' },
        [
          { outcome: 'success', tone: 'passed', count: 115 },
          { outcome: 'failure', tone: 'failed', count: 1 },
        ],
        116,
        100,
        'shard 99',
      ],
    );
  } finally {
    await f.close();
  }
});

test('a check state GitHub reports that the sidebar does not know reads as its raw value in the neutral group, and the detail still reads', async context => {
  await ghDouble(context, {
    ...forgeAccount,
    pullRequests: [
      change(12, {
        checks: 'SUPERSEDED',
        checkRuns: [
          { name: 'unit tests', status: 'COMPLETED', conclusion: 'SUPERSEDED' },
          { name: 'e2e', status: 'PARKED', conclusion: null },
          { context: 'ci/legacy', state: 'RETIRED', targetUrl: null },
        ],
      }),
    ],
  });
  const f = await boundWorkbench('pull-request-detail-unknown-checks');
  try {
    const result = await pullRequestDetail(f.workbench, f.projectId, 12);
    assert.ok(result.ok);
    const { checks } = result.pullRequest;
    const unrecognized = (raw: string) => ({ outcome: 'unrecognized', raw, tone: 'neutral' });
    assert.deepEqual(
      [
        checks.state,
        checks.counts,
        checks.listed.map(({ outcome, tone, ...listed }) => ({
          outcome,
          tone,
          raw: 'raw' in listed ? listed.raw : null,
        })),
      ],
      [
        unrecognized('SUPERSEDED'),
        [
          { ...unrecognized('SUPERSEDED'), count: 1 },
          { ...unrecognized('PARKED'), count: 1 },
          { ...unrecognized('RETIRED'), count: 1 },
        ],
        [unrecognized('SUPERSEDED'), unrecognized('PARKED'), unrecognized('RETIRED')],
      ],
    );
  } finally {
    await f.close();
  }
});

test('a missing pull request and forge CLI failures come back as forge failures with the forge text', async context => {
  const double = await ghDouble(context, { ...forgeAccount, pullRequests: [change(1)] });
  const f = await boundWorkbench('pull-request-detail-failures');
  const detail = (number: number) => pullRequestDetail(f.workbench, f.projectId, number);
  try {
    const missing = await detail(99);
    assert.ok(!missing.ok);
    assert.deepEqual(
      [missing.failure.kind, missing.failure.detail],
      ['inaccessible', 'GraphQL: Could not resolve to a PullRequest with the number of 99. (repository.pullRequest)'],
    );
    await double.set({
      ...forgeAccount,
      failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
    });
    const loggedOut = await detail(1);
    assert.ok(!loggedOut.ok);
    assert.equal(loggedOut.failure.kind, 'loggedOut');
    await assert.rejects(pullRequestDetail(f.workbench, f.projectId, 0), 'only a positive number is asked for');
  } finally {
    await f.close();
  }
});
