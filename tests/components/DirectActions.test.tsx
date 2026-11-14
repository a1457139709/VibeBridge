import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import type { Check, DirectAction, DirectActionResult, ForgeFailure, IssueDetail, PullRequestDetail } from '../../app/shared/forge';
import { deferred, provideWorkbench } from './support/workbench';
import { githubForge, githubView } from './support/forge';
import { issue as listedIssue, pullRequest as listedPullRequest, stubSidebarApis } from './support/forge-lists';

afterEach(cleanup);
before(stubSidebarApis);

const repositoryUrl = 'https://github.com/octo/alpha';
const links = { issues: `${repositoryUrl}/issues/`, pullRequests: `${repositoryUrl}/pull/` };
const issueDetail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => {
  const { blockedBy: _, unlistedBlockers: __, parent: ___, subIssues: ____, ...summary } = listedIssue(number, { title: 'Spec' });
  return { ...summary, url: `${repositoryUrl}/issues/${number}`, author: 'mona', assignees: [], body: '', comments: [], commentCount: 0,
    parent: null, subIssues: [], blockedBy: [], blocking: [], closingPullRequests: [], links, canWrite: true, ...extra };
};
const pullDetail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { title: 'Read-only detail' });
  return { ...summary, url: `${repositoryUrl}/pull/${number}`, changesUrl: `${repositoryUrl}/pull/${number}/files`, head: 'feature', base: 'main', body: '',
    timeline: [], commentCount: 0, codeComments: 0, closingIssues: [], links, review: { state: 'notRequired', requiredApprovals: null }, checks: [],
    conflicts: 'none', merge: { methods: ['merge', 'squash', 'rebase'], queue: false }, canWrite: true, ...extra };
};
const check = (name: string, result: Check['result'], required = false): Check => ({ name, result, required, url: null });

interface Forge { issue?: IssueDetail; pullRequest?: PullRequestDetail }
interface ActionRequest { action: DirectAction; answer(result: DirectActionResult): void }

/** The Workbench with a bound project and its sidebar open, its forge holding one issue (#3) and one pull request (#12).
 * Details and pages answer from `forge` at once; each direct action waits until the test answers it. */
function renderWorkbench(forge: Forge) {
  const project: ProjectView = {
    id: 'alpha', name: 'Alpha', directory: '/work/alpha', layout: { panel: 'panel' }, tray: [], repository: { forge: 'github', path: 'octo/alpha' }, ...githubView,
    panels: [{ id: 'panel', agent: 'codex', run: { id: 'run', panelId: 'panel', projectId: 'alpha', state: 'running', title: 'Alpha session' } }],
  };
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: true, width: 380 }, activeProjectId: 'alpha', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [project],
  };
  const actions: ActionRequest[] = [];
  const reads = { issue: 0, pullRequest: 0, pages: 0 };
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {}, subscribe: () => () => {},
    saveSidebar: async () => {}, activateProject: async () => {}, saveLayout: async () => {},
    issuePage: async () => { reads.pages++; return { ok: true, items: [listedIssue(3, { title: 'Spec' })], cursor: null, labels: [], counts: { open: 1, closed: 0 } }; },
    pullRequestPage: async () => { reads.pages++; return { ok: true, items: [listedPullRequest(12, { title: 'Read-only detail' })], cursor: null, labels: [], counts: { open: 1, closed: 0 } }; },
    issueDetail: async () => { reads.issue++; return { ok: true, issue: structuredClone(forge.issue!) }; },
    pullRequestDetail: async () => { reads.pullRequest++; return { ok: true, pullRequest: structuredClone(forge.pullRequest!) }; },
    directAction: (_, action) => {
      const answer = deferred<DirectActionResult>();
      actions.push({ action, answer: answer.resolve });
      return answer.promise;
    },
  });
  render(<App />);
  const action = (count: number) => waitFor(() => { assert.equal(actions.length, count, 'direct actions asked for'); return actions[count - 1]; });
  return { user: userEvent.setup(), action, reads };
}

const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const issuePane = () => within(sidebar()).getByRole('region', { name: 'Issue detail' });
const pullPane = () => within(sidebar()).getByRole('region', { name: 'Pull request detail' });
/** The texts of the buttons in the pull request's merge area. */
const mergeButtons = () => within(within(pullPane()).getByRole('region', { name: 'Merge requirements' })).queryAllByRole('button').map(button => button.textContent);
const failure = (detail: string): DirectActionResult => ({ ok: false, failure: { kind: 'transient', detail, forge: githubForge } });

async function openIssue(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('button', { name: 'Spec' }));
  await within(issuePane()).findByRole('heading', { name: 'Spec #3' });
  return view;
}
async function openPullRequest(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(within(await screen.findByRole('complementary', { name: 'GitHub' })).getByRole('tab', { name: 'Pull requests' }));
  await view.user.click(await within(sidebar()).findByRole('button', { name: 'Read-only detail' }));
  await within(pullPane()).findByRole('heading', { name: 'Read-only detail #12' });
  return view;
}

test('Close issue closes it as completed, shows it working meanwhile, and on success refreshes once to show what the forge holds', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action, reads } = await openIssue(forge);
  const pagesBefore = reads.pages, detailsBefore = reads.issue;
  await user.click(within(issuePane()).getByRole('button', { name: 'Close issue' }));
  const asked = await action(1);
  assert.deepEqual(asked.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  await within(issuePane()).findByRole('button', { name: 'Working…' });
  assert.ok(within(issuePane()).getByRole('button', { name: 'More ways to close' }).hasAttribute('disabled'), 'the other actions wait');
  forge.issue = issueDetail(3, { state: 'closed', closedAs: 'completed' });
  asked.answer({ ok: true, detail: '✓ Closed issue octo/alpha#3 (Spec)' });
  await within(issuePane()).findByRole('button', { name: 'Reopen issue' });
  await waitFor(() => assert.deepEqual([reads.issue - detailsBefore, reads.pages - pagesBefore], [1, 1], 'one refresh of the detail and the list'));
  assert.equal(within(issuePane()).queryByRole('button', { name: 'Close issue' }), null);
});

test('the close menu closes an issue as not planned, and a closed issue reopens', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: 'More ways to close' }));
  const menu = within(issuePane()).getByRole('menu', { name: 'More ways to close' });
  assert.deepEqual(within(menu).getAllByRole('menuitem').map(item => item.textContent), ['Close as completed', 'Close as not planned']);
  await user.click(within(menu).getByRole('menuitem', { name: 'Close as not planned' }));
  const close = await action(1);
  assert.deepEqual(close.action, { kind: 'closeIssue', number: 3, reason: 'notPlanned' });
  forge.issue = issueDetail(3, { state: 'closed', closedAs: 'notPlanned' });
  close.answer({ ok: true, detail: '' });
  await user.click(await within(issuePane()).findByRole('button', { name: 'Reopen issue' }));
  assert.deepEqual((await action(2)).action, { kind: 'reopenIssue', number: 3 });
});

test('a failed action shows the forge text under the buttons with Retry until dismissed or the next refresh', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: 'Close issue' }));
  (await action(1)).answer(failure('HTTP 502: Server Error (https://api.github.com/graphql)'));
  const alert = await within(issuePane()).findByRole('alert');
  assert.equal(within(alert).getByText(/failed/).textContent, 'Close as completed failed: HTTP 502: Server Error (https://api.github.com/graphql)');
  assert.ok(!within(issuePane()).getByRole('button', { name: 'Close issue' }).hasAttribute('disabled'));

  await user.click(within(alert).getByRole('button', { name: 'Retry' }));
  const retried = await action(2);
  assert.deepEqual(retried.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  await waitFor(() => assert.equal(within(issuePane()).queryByRole('alert'), null, 'retrying clears the failure'));
  retried.answer(failure('Still failing'));
  await user.click(within(await within(issuePane()).findByRole('alert')).getByRole('button', { name: 'Dismiss' }));
  assert.equal(within(issuePane()).queryByRole('alert'), null);

  await user.click(within(issuePane()).getByRole('button', { name: 'Close issue' }));
  (await action(3)).answer(failure('Again'));
  await within(issuePane()).findByRole('alert');
  await user.click(within(sidebar()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(within(issuePane()).queryByRole('alert'), null, 'the next refresh clears the failure'));
});

test('an action that finds the forge CLI missing or logged out puts the sidebar in that failure state', async () => {
  const forge: Forge = { issue: issueDetail(3), pullRequest: pullDetail(12) };
  const missing = await openIssue(forge);
  await missing.user.click(within(issuePane()).getByRole('button', { name: 'Close issue' }));
  const notInstalled: ForgeFailure = { kind: 'notInstalled', detail: '', forge: githubForge };
  (await missing.action(1)).answer({ ok: false, failure: notInstalled });
  await within(sidebar()).findByText('Could not find gh. Install it to use the sidebar.');
  assert.equal(within(sidebar()).queryByRole('region', { name: 'Issue detail' }), null, 'the failure fills the content area');
  cleanup();

  const loggedOut = await openPullRequest(forge);
  await loggedOut.user.click(within(pullPane()).getByRole('button', { name: 'Close PR' }));
  (await loggedOut.action(1)).answer({ ok: false, failure: { kind: 'loggedOut', detail: 'HTTP 401: Bad credentials', forge: githubForge } });
  await within(sidebar()).findByRole('button', { name: 'Copy gh auth login' });
});

test('with no write access to the repository, a detail shows no action buttons', async () => {
  const forge: Forge = { issue: issueDetail(3, { canWrite: false }), pullRequest: pullDetail(12, { canWrite: false }) };
  await openIssue(forge);
  assert.equal(within(issuePane()).queryByRole('button', { name: 'Close issue' }), null);
  cleanup();
  await openPullRequest(forge);
  assert.deepEqual(mergeButtons(), []);
});

test('merging takes two clicks in place: the method, then its confirmation', async () => {
  const forge: Forge = { pullRequest: pullDetail(12) };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: 'Create a merge commit' }));
  await user.click(within(pullPane()).getByRole('button', { name: 'Confirm: create a merge commit' }));
  const merge = await action(1);
  assert.deepEqual(merge.action, { kind: 'merge', number: 12, method: 'merge' });
  await within(pullPane()).findByRole('button', { name: 'Merging…' });
  assert.ok(within(pullPane()).getByRole('button', { name: 'Close PR' }).hasAttribute('disabled'), 'the other actions wait');
  forge.pullRequest = pullDetail(12, { state: 'merged' });
  merge.answer({ ok: true, detail: '' });
  await within(pullPane()).findByText('Merged', { selector: '.forge-merge-row' });
  assert.equal(within(pullPane()).queryByRole('alert'), null);
  assert.deepEqual(mergeButtons(), [], 'a merged pull request has no actions');
});

test('a pull request closes, and a closed one reopens', async () => {
  const forge: Forge = { pullRequest: pullDetail(12) };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: 'Close PR' }));
  const close = await action(1);
  assert.deepEqual(close.action, { kind: 'closePullRequest', number: 12 });
  forge.pullRequest = pullDetail(12, { state: 'closed' });
  close.answer({ ok: true, detail: '' });
  await user.click(await within(pullPane()).findByRole('button', { name: 'Reopen' }));
  assert.deepEqual((await action(2)).action, { kind: 'reopenPullRequest', number: 12 });
});

test('a blocked merge greys out the merge button and says why', async () => {
  const forge: Forge = { pullRequest: pullDetail(12, { state: 'draft', conflicts: 'conflicting', review: { state: 'required', requiredApprovals: 2 },
    checks: [check('unit', 'failed', true), check('lint', 'failed'), check('e2e', 'pending', true)] }) };
  await openPullRequest(forge);
  assert.ok(within(pullPane()).getByRole('button', { name: 'Create a merge commit' }).hasAttribute('disabled'));
  assert.ok(within(pullPane()).getByRole('button', { name: 'Choose a merge method' }).hasAttribute('disabled'));
  within(pullPane()).getByText('Cannot merge: this is a draft, conflicts, required checks failing, 2 approvals still needed');
  assert.ok(!within(pullPane()).getByRole('button', { name: 'Close PR' }).hasAttribute('disabled'), 'closing is not blocked');
  cleanup();

  forge.pullRequest = pullDetail(12, { review: { state: 'changesRequested', requiredApprovals: null }, checks: [check('e2e', 'pending', true)] });
  await openPullRequest(forge);
  within(pullPane()).getByText('Cannot merge: required checks still running, changes were requested');
  cleanup();

  forge.pullRequest = pullDetail(12, { review: { state: 'required', requiredApprovals: null }, conflicts: 'unknown', checks: [check('lint', 'failed')] });
  await openPullRequest(forge);
  within(pullPane()).getByText('Cannot merge: a required review is missing');
});

test('a repository that merges through a merge queue greys out merging and links the pull request on the forge', async () => {
  const forge: Forge = { pullRequest: pullDetail(12, { merge: { methods: ['squash'], queue: true } }) };
  await openPullRequest(forge);
  const merge = within(pullPane()).getByRole('button', { name: 'Merge' });
  assert.ok(merge.hasAttribute('disabled'));
  const note = merge.parentElement!;
  assert.match(note.textContent ?? '', /This repository merges through a merge queue/);
  assert.equal(within(note).getByRole('link', { name: 'Open on GitHub ↗' }).getAttribute('href'), `${repositoryUrl}/pull/12`);
});

// The chosen merge method is remembered for the rest of the app's run, so this test runs last.
test('the method menu lists only the methods the repository allows and remembers the last one chosen', async () => {
  const forge: Forge = { pullRequest: pullDetail(12, { merge: { methods: ['squash', 'rebase'], queue: false } }) };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: 'Squash and merge' }));
  await user.click(within(pullPane()).getByRole('button', { name: 'Choose a merge method' }));
  const menu = within(pullPane()).getByRole('menu', { name: 'Choose a merge method' });
  assert.deepEqual(within(menu).getAllByRole('menuitemradio').map(item => item.textContent), ['Squash and merge', 'Rebase and merge']);
  await user.click(within(menu).getByRole('menuitemradio', { name: 'Rebase and merge' }));
  await user.click(within(pullPane()).getByRole('button', { name: 'Rebase and merge' }));
  await user.click(within(pullPane()).getByRole('button', { name: 'Confirm: rebase and merge' }));
  assert.deepEqual((await action(1)).action, { kind: 'merge', number: 12, method: 'rebase' });
  cleanup();

  forge.pullRequest = pullDetail(12);
  await openPullRequest(forge);
  within(pullPane()).getByRole('button', { name: 'Rebase and merge' });
});
