import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { platformDescriptions, type DirectAction, type IssueDetailResult, type MergeRequestDetailResult } from '../app/shared/code-hosting';
import { testDirectory } from './support/directory';
import { ghDouble, type GhIssue, type GhPullRequest, type GhState } from './support/gh-double';

const issue = (number: number, extra: Partial<GhIssue> = {}): GhIssue => ({ number, title: `Issue ${number}`, state: 'OPEN', stateReason: null,
  createdAt: '2026-01-01T00:00:00Z', labels: [], ...extra });
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
  return {
    gh, workbench, project,
    act: (action: DirectAction) => workbench.directAction(project.id, action),
    issue: async (number: number) => issueShown(await workbench.issueDetail(project.id, number)),
    mergeRequest: async (number: number) => mergeRequestShown(await workbench.mergeRequestDetail(project.id, number)),
  };
}

function issueShown(result: IssueDetailResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.issue;
}

function mergeRequestShown(result: MergeRequestDetailResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.mergeRequest;
}

test('a direct action closes an issue as completed or not planned and reopens it on the platform', async context => {
  const f = await boundProject(context, 'direct-actions-issue', { issues: [issue(1), issue(2)] });
  assert.deepEqual(await f.act({ kind: 'closeIssue', number: 1, reason: 'completed' }), { ok: true });
  assert.deepEqual(await f.act({ kind: 'closeIssue', number: 2, reason: 'notPlanned' }), { ok: true });
  assert.deepEqual([await f.issue(1), await f.issue(2)].map(({ state, closedAs }) => ({ state, closedAs })),
    [{ state: 'closed', closedAs: 'completed' }, { state: 'closed', closedAs: 'notPlanned' }]);
  assert.deepEqual(await f.act({ kind: 'reopenIssue', number: 2 }), { ok: true });
  assert.equal((await f.issue(2)).state, 'open');
});

test('a direct action merges a merge request with the chosen method and the platform\'s own commit message, closes and reopens one', async context => {
  const f = await boundProject(context, 'direct-actions-merge-request', { pullRequests: [pullRequest(10), pullRequest(11)] });
  assert.deepEqual(await f.act({ kind: 'mergeMergeRequest', number: 10, method: 'squash' }), { ok: true });
  assert.equal((await f.mergeRequest(10)).state, 'merged');
  assert.deepEqual((await f.gh.state()).merges, [{ number: 10, method: 'SQUASH', headline: null, body: null }],
    'the platform writes the commit message');
  assert.deepEqual(await f.act({ kind: 'closeMergeRequest', number: 11 }), { ok: true });
  assert.equal((await f.mergeRequest(11)).state, 'closed');
  assert.deepEqual(await f.act({ kind: 'reopenMergeRequest', number: 11 }), { ok: true });
  assert.equal((await f.mergeRequest(11)).state, 'open');
});

test('a refused direct action brings back the platform\'s reason unchanged and changes nothing', async context => {
  const f = await boundProject(context, 'direct-actions-refused', { issues: [issue(1)], pullRequests: [pullRequest(10)],
    actionFailure: { exit: 1, stderr: 'gh: Pull Request is not mergeable (mergePullRequest)\n' } });
  for (const action of [{ kind: 'mergeMergeRequest', number: 10, method: 'merge' }, { kind: 'closeMergeRequest', number: 10 },
    { kind: 'reopenMergeRequest', number: 10 }, { kind: 'closeIssue', number: 1, reason: 'completed' }, { kind: 'reopenIssue', number: 1 }] as const) {
    assert.deepEqual(await f.act(action), { ok: false, failure: { kind: 'transient', platform: platformDescriptions.github,
      output: 'gh: Pull Request is not mergeable (mergePullRequest)' } }, action.kind);
  }
  assert.equal((await f.mergeRequest(10)).state, 'open');
  assert.equal((await f.issue(1)).state, 'open');
});

test('a direct action reports a CLI that is not installed or not signed in, and a missing item', async context => {
  const f = await boundProject(context, 'direct-actions-unavailable', { issues: [issue(1)], pullRequests: [pullRequest(10)] });
  const missing = await f.act({ kind: 'closeIssue', number: 10, reason: 'completed' });
  assert.ok(!missing.ok && missing.failure.kind === 'unreachable', 'a merge request number is no issue');
  await f.gh.set({ failure: { exit: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login' } });
  const signedOut = await f.act({ kind: 'reopenIssue', number: 1 });
  assert.ok(!signedOut.ok && signedOut.failure.kind === 'signedOut', JSON.stringify(signedOut));
  await f.gh.uninstall();
  const notInstalled = await f.act({ kind: 'closeMergeRequest', number: 10 });
  assert.ok(!notInstalled.ok && notInstalled.failure.kind === 'notInstalled', JSON.stringify(notInstalled));
  await assert.rejects(f.act({ kind: 'mergeMergeRequest', number: 10, method: 'fast-forward' } as unknown as DirectAction), /directActionInvalid/);
  await f.workbench.bindRepository(f.project.id, null);
  await assert.rejects(f.act({ kind: 'reopenIssue', number: 1 }), /repositoryUnbound/);
});

test('a detail tells whether the signed-in account may write to the repository', async context => {
  const f = await boundProject(context, 'direct-actions-permission', { issues: [issue(1)], pullRequests: [pullRequest(10)] });
  assert.deepEqual([(await f.issue(1)).writable, (await f.mergeRequest(10)).writable], [true, true]);
  for (const permission of ['TRIAGE', 'READ'] as const) {
    await f.gh.set({ ...await f.gh.state(), permission });
    assert.deepEqual([(await f.issue(1)).writable, (await f.mergeRequest(10)).writable], [false, false], permission);
  }
});
