import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import type { Check, ForgeCapabilities, IssueDetailResult, PullRequestDetail, PullRequestDetailResult, PullRequestReference } from '../../app/shared/forge';
import { deferred, provideWorkbench } from './support/workbench';
import { githubCapabilities, githubView } from './support/forge';
import { issue as listedIssue, pullRequest as listedPullRequest, stubSidebarApis } from './support/forge-lists';

afterEach(cleanup);
before(stubSidebarApis);

const repositoryUrl = 'https://github.com/octo/alpha';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
const links = { issues: `${repositoryUrl}/issues/`, pullRequests: `${repositoryUrl}/pull/` };
const detail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { createdAt: hoursAgo(50) });
  return { ...summary, url: `${repositoryUrl}/pull/${number}`, changesUrl: `${repositoryUrl}/pull/${number}/files`, head: 'feature', base: 'main', body: '',
    timeline: [], commentCount: 0, codeComments: 0, closingIssues: [], links, review: { state: 'notRequired', requiredApprovals: null }, checks: [],
    conflicts: 'none', merge: { methods: ['merge', 'squash', 'rebase'], queue: false }, canWrite: true, ...extra };
};
const check = (name: string, result: Check['result'], required = false): Check => ({ name, result, required, url: `${repositoryUrl}/runs/${name}` });

interface Request { kind: 'issue' | 'pullRequest'; number: number; answer(result: IssueDetailResult | PullRequestDetailResult): void }

/** The Workbench with a bound project and its sidebar open, listing one pull request and one issue. Every detail request waits until the test answers it. */
function renderWorkbench({ capabilities = githubCapabilities, closingPullRequests = [] }: { capabilities?: ForgeCapabilities; closingPullRequests?: PullRequestReference[] } = {}) {
  const project: ProjectView = {
    id: 'alpha', name: 'Alpha', directory: '/work/alpha', layout: { panel: 'panel' }, tray: [], repository: { forge: 'github', path: 'octo/alpha' }, ...githubView, capabilities,
    panels: [{ id: 'panel', agent: 'codex', run: { id: 'run', panelId: 'panel', projectId: 'alpha', state: 'running', title: 'Alpha session' } }],
  };
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: true, width: 380 }, activeProjectId: 'alpha', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [project],
  };
  const requests: Request[] = [];
  const ask = (kind: Request['kind'], number: number) => {
    const answer = deferred<IssueDetailResult | PullRequestDetailResult>();
    requests.push({ kind, number, answer: answer.resolve });
    return answer.promise;
  };
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {}, subscribe: () => () => {},
    saveSidebar: async () => {}, activateProject: async () => {}, saveLayout: async () => {},
    issuePage: async () => ({ ok: true, items: [listedIssue(3, { title: 'Spec' })], cursor: null, labels: [], counts: { open: 1, closed: 0 } }),
    pullRequestPage: async () => ({ ok: true, items: [listedPullRequest(12, { title: 'Read-only detail' })], cursor: null, labels: [], counts: { open: 1, closed: 0 } }),
    issueDetail: async (_, number) => {
      const result = await ask('issue', number) as IssueDetailResult;
      return result.ok ? { ...result, issue: { ...result.issue, closingPullRequests } } : result;
    },
    pullRequestDetail: (_, number) => ask('pullRequest', number) as Promise<PullRequestDetailResult>,
  });
  render(<App />);
  const request = (count: number) => waitFor(() => { assert.equal(requests.length, count, 'detail requests made'); return requests[count - 1]; });
  return { user: userEvent.setup(), request };
}

const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const pane = () => within(sidebar()).getByRole('region', { name: 'Pull request detail' });
const mergeArea = () => within(pane()).getByRole('region', { name: 'Merge requirements' });
const rowOf = (name: string) => within(mergeArea()).getByText(name, { selector: 'b' }).closest('.forge-merge-row') as HTMLElement;

/** Opens pull request #12 from the list and answers its detail. */
async function openPullRequest(pullRequest: PullRequestDetail, options: Parameters<typeof renderWorkbench>[0] = {}) {
  const view = renderWorkbench(options);
  await view.user.click(within(await screen.findByRole('complementary', { name: 'GitHub' })).getByRole('tab', { name: 'Pull requests' }));
  await view.user.click(await within(sidebar()).findByRole('button', { name: 'Read-only detail' }));
  const first = await view.request(1);
  assert.deepEqual([first.kind, first.number], ['pullRequest', 12]);
  first.answer({ ok: true, pullRequest });
  await within(pane()).findByRole('heading', { name: `${pullRequest.title} #12` });
  return view;
}

test('a pull request row opens its detail: title, state, head into base, the changes on the forge, labels, and the issues it closes', async () => {
  const { user, request } = await openPullRequest(detail(12, { title: 'Read-only detail', head: 'feat/detail', labels: [{ name: 'bug', color: 'd73a4a' }],
    closingIssues: [{ number: 3, title: 'Spec', state: 'open', closedAs: null, url: `${repositoryUrl}/issues/3` },
      { number: 8, title: 'Elsewhere', state: 'closed', closedAs: 'completed', url: 'https://github.com/octo/other/issues/8' }] }));
  const doc = within(pane());
  assert.ok(doc.getByText('Open', { selector: '.forge-pill' }));
  assert.match(pane().querySelector('.forge-pull-branches')!.textContent!, /^mona wants to merge feat\/detail into main · 2d ago$/);
  assert.equal(doc.getByRole('link', { name: 'View changes on GitHub ↗' }).getAttribute('href'), `${repositoryUrl}/pull/12/files`);
  assert.ok(doc.getByText('bug'));
  const closes = doc.getByRole('group', { name: 'Closes on merge' });
  assert.equal(within(closes).getByRole('link', { name: /Elsewhere/ }).getAttribute('href'), 'https://github.com/octo/other/issues/8', 'an issue of another repository opens in the browser');
  await user.click(within(closes).getByRole('button', { name: /Spec/ }));
  const issue = await request(2);
  assert.deepEqual([issue.kind, issue.number], ['issue', 3], 'an issue of the bound repository opens in the sidebar');
  await user.click(within(sidebar()).getByRole('button', { name: 'Back' }));
  await within(pane()).findByRole('heading', { name: 'Read-only detail #12' });
});

test('the body, comments and review summaries follow in time order, reviews with their verdict, and code comments only as a count with a link', async () => {
  await openPullRequest(detail(12, { title: 'Timeline', body: '<p>The body.</p>', codeComments: 5, timeline: [
    { author: 'bob', createdAt: hoursAgo(4), html: '<p>Handle the draft row.</p>', verdict: 'changesRequested' },
    { author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null },
    { author: 'alice', createdAt: hoursAgo(2), html: '<p>LGTM</p>', verdict: 'approved' },
  ] }));
  const cards = [...pane().querySelectorAll('.forge-card')].map(card => card.textContent);
  assert.deepEqual(cards, ['mona 2d agoThe body.', 'bob Changes requested 4h agoHandle the draft row.', 'hubot 3h agoRebased.', 'alice Approved 2h agoLGTM']);
  const code = pane().querySelector('.forge-code-comments')!;
  assert.match(code.textContent!, /5 code comments/);
  assert.equal(within(code as HTMLElement).getByRole('link').getAttribute('href'), `${repositoryUrl}/pull/12/files`);
  assert.ok(!within(pane()).queryByRole('button', { name: /Approve/ }), 'no approve button');
});

test('a blocked pull request lists its failing and running checks with their logs, folds the passed ones, and names the conflict and the draft', async () => {
  const { user } = await openPullRequest(detail(12, { state: 'draft', review: { state: 'changesRequested', requiredApprovals: 1 }, conflicts: 'conflicting', checks: [
    check('lint', 'passed', true), check('unit tests', 'failed', true), check('e2e', 'pending'), check('docs', 'skipped'), check('build', 'passed'),
  ] }));
  const rows = [...mergeArea().querySelectorAll(':scope > .forge-merge-row > b, :scope > .forge-merge-row > .forge-merge-row-head > b')].map(name => name.textContent);
  assert.deepEqual(rows, ['Review', 'Checks', 'Conflicts', 'Draft'], 'in order: review, checks, conflicts, draft');
  assert.match(rowOf('Review').textContent!, /Changes requested; needs another review/);
  const checks = rowOf('Checks');
  assert.match(checks.textContent!, /1 failed, 1 running, 3 passed/);
  const listed = () => [...checks.querySelectorAll('.forge-merge-check')].map(item => item.textContent);
  assert.deepEqual(listed(), ['✗unit testsRequiredChecks failedLog ↗', '●e2eChecks runningLog ↗']);
  assert.equal(within(checks).getAllByRole('link', { name: 'Log ↗' })[0].getAttribute('href'), `${repositoryUrl}/runs/unit tests`);
  await user.click(within(checks).getByRole('button', { name: '3 passed ▸' }));
  assert.deepEqual(listed().slice(2), ['✓lintRequiredChecks passedLog ↗', '–docsSkippedLog ↗', '✓buildChecks passedLog ↗']);
  await user.click(within(checks).getByRole('button', { name: 'Hide passed checks' }));
  assert.equal(listed().length, 2);
  assert.match(rowOf('Conflicts').textContent!, /Conflicts with main; resolve them first/);
  assert.match(rowOf('Draft').textContent!, /Can be merged once marked ready for review \(on GitHub\)/);
});

test('a pull request ready to merge shows an approved review, passing checks and no conflicts', async () => {
  await openPullRequest(detail(12, { review: { state: 'approved', requiredApprovals: 1 }, checks: [check('lint', 'passed')] }));
  assert.match(rowOf('Review').textContent!, /Approved/);
  assert.match(rowOf('Checks').textContent!, /^✓Checks1 passed/);
  assert.match(rowOf('Conflicts').textContent!, /No conflicts/);
  assert.equal(within(mergeArea()).queryByText('Draft'), null);
});

for (const [review, text] of [
  [{ state: 'required', requiredApprovals: 2 }, 'At least 2 approvals required'],
  [{ state: 'required', requiredApprovals: null }, 'Review required'],
  [{ state: 'notRequired', requiredApprovals: null }, 'Review not required'],
] as const) {
  test(`a review ${review.state} with ${review.requiredApprovals ?? 'unknown'} required approvals reads: ${text}`, async () => {
    await openPullRequest(detail(12, { review, conflicts: 'unknown' }));
    assert.match(rowOf('Review').textContent!, new RegExp(text));
    assert.match(rowOf('Checks').textContent!, /No checks/);
    assert.match(rowOf('Conflicts').textContent!, /Checking for conflicts/);
  });
}

for (const [state, text] of [['merged', 'Merged'], ['closed', 'Closed without merging']] as const) {
  test(`a ${state} pull request's merge area says only that it is ${state}, not what blocked a merge`, async () => {
    await openPullRequest(detail(12, { state, conflicts: 'conflicting', checks: [check('lint', 'failed')], canWrite: false }));
    assert.equal(mergeArea().textContent, text);
  });
}

test('a forge without required checks marks none', async () => {
  await openPullRequest(detail(12, { checks: [check('unit tests', 'failed', true)] }), { capabilities: { ...githubCapabilities, requiredChecks: false } });
  assert.equal(within(mergeArea()).queryByText('Required'), null);
});

test('a pull request that closes an issue opens in the sidebar from the issue detail; one of another repository opens in the browser', async () => {
  const pull = (number: number, url: string): PullRequestReference => ({ number, title: `Change ${number}`, state: 'open', checks: 'passed', url });
  const { user, request } = renderWorkbench({ closingPullRequests: [pull(12, `${repositoryUrl}/pull/12`), pull(40, 'https://github.com/octo/other/pull/40')] });
  await user.click(await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('button', { name: 'Spec' }));
  const issue = await request(1);
  issue.answer({ ok: true, issue: { ...listedIssue(3, { title: 'Spec' }), url: `${repositoryUrl}/issues/3`, author: 'mona', assignees: [], body: '', comments: [],
    commentCount: 0, parent: null, subIssues: [], blockedBy: [], blocking: [], closingPullRequests: [], links, canWrite: true } });
  const closing = await within(sidebar()).findByRole('region', { name: 'Pull requests that close this issue on merge' });
  assert.equal(within(closing).getByRole('link', { name: /Change 40/ }).getAttribute('href'), 'https://github.com/octo/other/pull/40');
  await user.click(within(closing).getByRole('button', { name: /Change 12/ }));
  const opened = await request(2);
  assert.deepEqual([opened.kind, opened.number], ['pullRequest', 12]);
  opened.answer({ ok: true, pullRequest: detail(12, { title: 'Change 12' }) });
  await within(pane()).findByRole('heading', { name: 'Change 12 #12' });
});

test('a link to a pull request of the bound repository in the body opens it in the sidebar', async () => {
  const { user, request } = await openPullRequest(detail(12, { title: 'Linking', body: `<p>Follows <a href="${repositoryUrl}/pull/11">#11</a>.</p>` }));
  await user.click(within(pane()).getByRole('link', { name: '#11' }));
  const next = await request(2);
  assert.deepEqual([next.kind, next.number], ['pullRequest', 11]);
});
