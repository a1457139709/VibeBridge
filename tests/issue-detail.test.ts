import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { IssueDetailResult } from '../app/shared/code-hosting';
import { testDirectory } from './support/directory';
import { ghDouble, type GhIssue, type GhState } from './support/gh-double';

const issue = (number: number, extra: Partial<GhIssue> = {}): GhIssue => ({ number, title: `Issue ${number}`, state: 'OPEN', stateReason: null,
  createdAt: `2026-01-${String(number).padStart(2, '0')}T00:00:00Z`, labels: [], ...extra });

const pullRequest = { author: 'mona', createdAt: '2026-01-10T00:00:00Z', labels: [] };

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
  return { gh, workbench, detail: (number: number) => workbench.issueDetail(project.id, number), project };
}

function detail(result: IssueDetailResult) {
  assert.ok(result.ok, JSON.stringify(result));
  return result.issue;
}

test('an issue detail holds its rendered body and every comment, its people, its relations and the merge requests that close it', async context => {
  const f = await boundProject(context, 'issue-detail', {
    commentPageSize: 2,
    issues: [
      issue(1, { title: 'Epic' }),
      issue(2, { state: 'CLOSED', stateReason: 'COMPLETED' }),
      issue(3, {
        title: 'Detail', author: 'mona', assignees: ['octo', 'hubot'], labels: ['bug'], bodyHTML: '<p>Body <a href="https://github.com/octo/app/issues/1">#1</a></p>',
        comments: [1, 2, 3].map(day => ({ author: 'hubot', createdAt: `2026-02-0${day}T00:00:00Z`, bodyHTML: `<p>Comment ${day}</p>` })),
        parent: 1, blockedBy: [2], closedBy: [10, 11, 12],
      }),
      issue(4, { parent: 3 }), issue(5, { blockedBy: [3] }),
    ],
    labels: [{ name: 'bug', color: 'd73a4a' }],
    pullRequests: [
      { ...pullRequest, number: 10, title: 'Fix it', state: 'OPEN', isDraft: false, checks: 'FAILURE' },
      { ...pullRequest, number: 11, title: 'Merged fix', state: 'MERGED', isDraft: false, checks: 'SUCCESS' },
      { ...pullRequest, number: 12, title: 'Abandoned fix', state: 'CLOSED', isDraft: true, checks: null },
    ],
  });
  const shown = detail(await f.detail(3));
  assert.deepEqual({ ...shown, comments: undefined }, {
    number: 3, title: 'Detail', state: 'open', closedAs: null, createdAt: '2026-01-03T00:00:00Z', url: 'https://github.com/octo/app/issues/3',
    labels: [{ name: 'bug', color: 'd73a4a' }], author: 'mona', assignees: ['octo', 'hubot'],
    body: '<p>Body <a href="https://github.com/octo/app/issues/1">#1</a></p>', commentCount: 3, comments: undefined,
    parent: { number: 1, title: 'Epic', state: 'open', closedAs: null, repository: 'octo/app', url: 'https://github.com/octo/app/issues/1' },
    subIssues: [{ number: 4, title: 'Issue 4', state: 'open', closedAs: null, repository: 'octo/app', url: 'https://github.com/octo/app/issues/4' }],
    blockedBy: [{ number: 2, title: 'Issue 2', state: 'closed', closedAs: 'completed', repository: 'octo/app', url: 'https://github.com/octo/app/issues/2' }],
    blocking: [{ number: 5, title: 'Issue 5', state: 'open', closedAs: null, repository: 'octo/app', url: 'https://github.com/octo/app/issues/5' }],
    closingMergeRequests: [
      { number: 10, title: 'Fix it', state: 'open', draft: false, checks: 'failing', url: 'https://github.com/octo/app/pull/10' },
      { number: 11, title: 'Merged fix', state: 'merged', draft: false, checks: 'passing', url: 'https://github.com/octo/app/pull/11' },
      { number: 12, title: 'Abandoned fix', state: 'closed', draft: true, checks: null, url: 'https://github.com/octo/app/pull/12' },
    ],
  });
  assert.deepEqual(shown.comments, [1, 2, 3].map(day => ({ author: 'hubot', createdAt: `2026-02-0${day}T00:00:00Z`, body: `<p>Comment ${day}</p>` })),
    'comments past the first page are read too');
});

test('an issue detail tells a missing issue and platform failures apart', async context => {
  const f = await boundProject(context, 'issue-detail-failures', { issues: [issue(1)] });
  const missing = await f.detail(99);
  assert.ok(!missing.ok && missing.failure.kind === 'unreachable', JSON.stringify(missing));
  await f.gh.set({ failure: { exit: 1, stderr: 'HTTP 502: Bad Gateway' } });
  const transient = await f.detail(1);
  assert.ok(!transient.ok && transient.failure.kind === 'transient' && /Bad Gateway/.test(transient.failure.output), JSON.stringify(transient));
  await assert.rejects(f.detail(1.5), /issueNumberInvalid/);
  await f.workbench.bindRepository(f.project.id, null);
  await assert.rejects(f.detail(1), /repositoryUnbound/);
});
