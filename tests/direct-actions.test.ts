import test from 'node:test';
import type { ForgeLists } from '../app/shared/forge/sidebar-data';
import assert from 'node:assert/strict';
import { ghDouble, type GhPullRequest } from './support/gh-double';
import { fromAny } from '@total-typescript/shoehorn';
import {
  boundWorkbench,
  day,
  forgeAccount,
  issueDetail,
  pullRequestDetail,
  shownDetail,
  shownLists,
  showList,
} from './support/bound-workbench';

const issue = (number: number, extra: object = {}) => ({
  number,
  title: `Issue ${number}`,
  state: 'OPEN' as const,
  createdAt: day(number),
  labels: [],
  ...extra,
});
const change = (number: number, extra: Partial<GhPullRequest> = {}): GhPullRequest => ({
  number,
  title: `Change ${number}`,
  state: 'OPEN',
  createdAt: day(number),
  ...extra,
});

test('closing an issue as completed or not planned and reopening it carry back the forge text, and the issue reads back changed', async context => {
  await ghDouble(context, { ...forgeAccount, issues: [issue(3), issue(4)] });
  const f = await boundWorkbench('direct-actions-issue');
  const read = async (number: number) => {
    const result = await issueDetail(f.workbench, f.projectId, number);
    assert.ok(result.ok);
    return [result.issue.state, result.issue.closedAs];
  };
  try {
    assert.deepEqual(
      await f.workbench.performDirectAction(f.projectId, { kind: 'closeIssue', number: 3, reason: 'completed' }),
      { ok: true, detail: '✓ Closed issue octo/tools#3 (Issue 3)' },
    );
    assert.deepEqual(await read(3), ['closed', 'completed']);
    assert.deepEqual(
      await f.workbench.performDirectAction(f.projectId, { kind: 'closeIssue', number: 4, reason: 'notPlanned' }),
      { ok: true, detail: '✓ Closed issue octo/tools#4 (Issue 4)' },
    );
    assert.deepEqual(await read(4), ['closed', 'notPlanned']);
    assert.deepEqual(await f.workbench.performDirectAction(f.projectId, { kind: 'reopenIssue', number: 3 }), {
      ok: true,
      detail: '✓ Reopened issue octo/tools#3 (Issue 3)',
    });
    assert.deepEqual(await read(3), ['open', null]);
  } finally {
    await f.close();
  }
});

test('a direct action reported on an issue reloads its detail, and its row shows the new state where it was', async context => {
  await ghDouble(context, { ...forgeAccount, issues: [issue(3), issue(4)] });
  const f = await boundWorkbench('direct-actions-reload');
  const item = { kind: 'issue', number: 3 } as const;
  try {
    const listed = await showList(f.workbench, f.projectId);
    assert.deepEqual(
      listed.issues.loaded?.items.map(row => row.number),
      [4, 3],
    );
    await issueDetail(f.workbench, f.projectId, 3);
    assert.ok(
      (await f.workbench.performDirectAction(f.projectId, { kind: 'closeIssue', number: 3, reason: 'completed' })).ok,
    );
    let lists: ForgeLists | undefined;
    const detail = await shownDetail(f.workbench, f.projectId, item, async () => {
      lists = await shownLists(f.workbench, f.projectId, () =>
        f.workbench.forgeSidebar.reloadChanged(f.projectId, item),
      );
    });
    assert.deepEqual(
      lists?.issues.loaded?.items.map(row => [row.number, row.state]),
      [
        [4, 'open'],
        [3, 'closed'],
      ],
      'the closed issue stays in place among the open issues, showing its new state',
    );
    assert.ok(detail.ok && 'issue' in detail);
    assert.deepEqual([detail.issue.state, detail.issue.closedAs], ['closed', 'completed']);
  } finally {
    await f.close();
  }
});

test('merging with a method, closing and reopening a pull request carry back the forge text, and the pull request reads back changed', async context => {
  await ghDouble(context, { ...forgeAccount, pullRequests: [change(12), change(13)] });
  const f = await boundWorkbench('direct-actions-pull-request');
  const read = async (number: number) => {
    const result = await pullRequestDetail(f.workbench, f.projectId, number);
    assert.ok(result.ok);
    return result.pullRequest.state;
  };
  try {
    assert.deepEqual(await f.workbench.performDirectAction(f.projectId, { kind: 'closePullRequest', number: 13 }), {
      ok: true,
      detail: '✓ Closed pull request octo/tools#13 (Change 13)',
    });
    assert.equal(await read(13), 'closed');
    assert.deepEqual(await f.workbench.performDirectAction(f.projectId, { kind: 'reopenPullRequest', number: 13 }), {
      ok: true,
      detail: '✓ Reopened pull request octo/tools#13 (Change 13)',
    });
    assert.equal(await read(13), 'open');
    assert.deepEqual(
      await f.workbench.performDirectAction(f.projectId, { kind: 'merge', number: 12, method: 'squash' }),
      {
        ok: true,
        detail: '✓ Squashed and merged pull request octo/tools#12 (Change 12)',
      },
    );
    assert.equal(await read(12), 'merged');
  } finally {
    await f.close();
  }
});

test('a refused direct action comes back as a forge failure with the forge text unchanged', async context => {
  const double = await ghDouble(context, {
    ...forgeAccount,
    mergeMethods: { rebase: false },
    issues: [issue(3)],
    pullRequests: [change(12, { mergeable: 'CONFLICTING' }), change(13, { state: 'MERGED' }), change(14)],
  });
  const f = await boundWorkbench('direct-actions-refused');
  const failure = async (action: Parameters<typeof f.workbench.performDirectAction>[1]) => {
    const result = await f.workbench.performDirectAction(f.projectId, action);
    assert.ok(!result.ok);
    return [result.failure.kind, result.failure.detail];
  };
  try {
    assert.deepEqual(await failure({ kind: 'merge', number: 12, method: 'merge' }), [
      'transient',
      'X Pull request octo/tools#12 is not mergeable: the merge commit cannot be cleanly created.',
    ]);
    assert.deepEqual(await failure({ kind: 'reopenPullRequest', number: 13 }), [
      'transient',
      "X Pull request octo/tools#13 (Change 13) can't be reopened because it was already merged",
    ]);
    assert.deepEqual(await failure({ kind: 'merge', number: 14, method: 'rebase' }), [
      'transient',
      'GraphQL: Rebase merges are not allowed on this repository. (mergePullRequest)',
    ]);
    assert.deepEqual(await failure({ kind: 'closeIssue', number: 99, reason: 'completed' }), [
      'transient',
      'GraphQL: Could not resolve to an issue or pull request with the number of 99. (repository.issueOrPullRequest)',
    ]);
    await double.set({ ...forgeAccount, permission: 'READ', issues: [issue(3)] });
    assert.deepEqual(await failure({ kind: 'closeIssue', number: 3, reason: 'completed' }), [
      'transient',
      'GraphQL: octo does not have the correct permissions to execute `CloseIssue` (closeIssue)',
    ]);
    await double.set({
      ...forgeAccount,
      failure: { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
    });
    assert.deepEqual(await failure({ kind: 'reopenIssue', number: 3 }), [
      'loggedOut',
      'To get started with GitHub CLI, please run:  gh auth login',
    ]);
    double.uninstall();
    assert.deepEqual(await failure({ kind: 'reopenIssue', number: 3 }), ['notInstalled', '']);
    await assert.rejects(
      f.workbench.performDirectAction(f.projectId, fromAny({ kind: 'merge', number: 14, method: 'octopus' })),
      'only a known action is carried out',
    );
  } finally {
    await f.close();
  }
});

test('a detail says whether the active account may write to the repository', async context => {
  const double = await ghDouble(context, { ...forgeAccount, issues: [issue(3)], pullRequests: [change(12)] });
  const f = await boundWorkbench('direct-actions-permission');
  const canWrite = async () => {
    const [issueResult, pullResult] = [
      await issueDetail(f.workbench, f.projectId, 3),
      await pullRequestDetail(f.workbench, f.projectId, 12),
    ];
    assert.ok(issueResult.ok && pullResult.ok);
    return [issueResult.issue.canWrite, pullResult.pullRequest.canWrite];
  };
  try {
    assert.deepEqual(await canWrite(), [true, true]);
    for (const permission of ['READ', 'TRIAGE'] as const) {
      await double.set({ ...forgeAccount, permission, issues: [issue(3)], pullRequests: [change(12)] });
      assert.deepEqual(await canWrite(), [false, false], permission);
    }
    await double.set({ ...forgeAccount, permission: 'MAINTAIN', issues: [issue(3)], pullRequests: [change(12)] });
    assert.deepEqual(await canWrite(), [true, true]);
  } finally {
    await f.close();
  }
});
