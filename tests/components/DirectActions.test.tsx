import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import { platformDescriptions, type DirectAction, type DirectActionResult, type IssueDetail, type MergeRequestDetail, type MergeRequestSummary,
  type MergeState, type RepositoryChoices } from '../../app/shared/code-hosting';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  Object.assign(globalThis, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
});

const github = platformDescriptions.github;
const app: ProjectView = { id: 'app', name: 'App project', directory: '/work/app', layout: null, panels: [], tray: [], dispatches: [],
  repository: { platform: 'github', path: 'octo/app' } };

const summary = (number: number): MergeRequestSummary => ({ number, title: `Change ${number}`, state: 'open', draft: false, author: 'mona',
  createdAt: '2026-11-01T00:00:00Z', checks: null, labels: [], url: `https://github.com/octo/app/pull/${number}` });
const mergeState = (extra: Partial<MergeState> = {}): MergeState => ({ review: null, checks: [], conflicting: false, methods: ['merge', 'squash', 'rebase'], mergeThrough: null, ...extra });
const mergeRequest = (number: number, extra: Partial<MergeRequestDetail> = {}): MergeRequestDetail => {
  const { checks: _checks, ...rest } = summary(number);
  return { ...rest, head: 'feature', base: 'main', changesUrl: `https://github.com/octo/app/pull/${number}/files`, body: '<p>Body</p>',
    comments: [], reviews: [], closingIssues: [], merge: mergeState(), writable: true, ...extra };
};
const issue = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, author: 'mona', assignees: [], body: '<p>Issue body</p>',
  commentCount: 0, comments: [], parent: null, subIssues: [], blockedBy: [], blocking: [], closingMergeRequests: [], writable: true, ...extra });

/**
 * The workbench with the sidebar open on the App project, listing issue #3 and pull requests #10 to #12. Details answer with
 * what the test holds for them; every direct action waits for the test to answer it.
 */
async function renderSidebar(shown: { issues: IssueDetail[]; mergeRequests: MergeRequestDetail[] }) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: true, width: 420 }, activeProjectId: app.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [app],
  };
  const reads = { issue: 0, mergeRequest: 0, issuePage: 0, mergeRequestPage: 0 };
  const actions: { action: DirectAction; answer(result: DirectActionResult): void; fail(error: Error): void }[] = [];
  window.open = (() => null) as typeof window.open;
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, ready: async () => {}, activateProject: async () => {},
    saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    issuePage: async () => {
      reads.issuePage++;
      return { ok: true, page: { issues: [{ number: 3, title: 'Issue 3', state: 'open', closedAs: null, createdAt: '2026-11-01T00:00:00Z',
        labels: [], url: 'https://github.com/octo/app/issues/3', parent: null, subIssues: null, blockedBy: [] }], next: null, labels: [] } };
    },
    mergeRequestPage: async () => { reads.mergeRequestPage++; return { ok: true, page: { mergeRequests: [summary(12), summary(11), summary(10)], next: null, labels: [] } }; },
    issueDetail: async (_projectId, number) => { reads.issue++; return { ok: true, issue: shown.issues.find(each => each.number === number)! }; },
    mergeRequestDetail: async (_projectId, number) => { reads.mergeRequest++; return { ok: true, mergeRequest: shown.mergeRequests.find(each => each.number === number)! }; },
    directAction: (_projectId, action) => {
      const reply = deferred<DirectActionResult>();
      actions.push({ action, answer: reply.resolve, fail: reply.reject });
      return reply.promise;
    } });
  render(<App />);
  const user = userEvent.setup();
  const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
  await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('listitem', { name: '#3 Issue 3' });
  const nextAction = async (count: number) => {
    await waitFor(() => assert.ok(actions.length > count, `action ${count + 1}`));
    return actions[count];
  };
  return {
    user, sidebar, reads, actions, nextAction,
    openIssue: async (number: number) => {
      await user.click(within(sidebar()).getByText(`Issue ${number}`));
      const region = await screen.findByRole('region', { name: `Issue #${number}` });
      await within(region).findByRole('heading', { name: new RegExp(`Issue ${number}`) });
      return region;
    },
    openPullRequest: async (number: number) => {
      await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
      await user.click(await within(sidebar()).findByText(`Change ${number}`));
      const region = await screen.findByRole('region', { name: `Pull request #${number}` });
      await within(region).findByRole('heading', { name: new RegExp(`Change ${number}`) });
      return region;
    },
  };
}

test('an open issue closes as completed with one click, or as not planned from its menu, then the detail and the list read afresh once', async () => {
  const shown = { issues: [issue(3)], mergeRequests: [] };
  const f = await renderSidebar(shown);
  const detail = await f.openIssue(3);
  await f.user.click(within(detail).getByRole('button', { name: 'Close as completed' }));
  const close = await f.nextAction(0);
  assert.deepEqual(close.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  await waitFor(() => assert.equal(within(detail).getByRole('button', { name: 'Close as completed' }).getAttribute('aria-busy'), 'true'));
  assert.ok((within(detail).getByRole('button', { name: 'More ways to close' }) as HTMLButtonElement).disabled, 'other actions wait');
  const before = { ...f.reads };
  shown.issues = [issue(3, { state: 'closed', closedAs: 'completed' })];
  close.answer({ ok: true });
  await within(detail).findByRole('button', { name: 'Reopen' });
  assert.deepEqual([f.reads.issue - before.issue, f.reads.issuePage - before.issuePage], [1, 1], 'one refresh, no optimistic change');

  shown.issues = [issue(3)];
  await f.user.click(within(detail).getByRole('button', { name: 'Reopen' }));
  (await f.nextAction(1)).answer({ ok: true });
  await f.user.click(await within(detail).findByRole('button', { name: 'More ways to close' }));
  await f.user.click(within(detail).getByRole('menuitem', { name: 'Close as not planned' }));
  assert.deepEqual((await f.nextAction(2)).action, { kind: 'closeIssue', number: 3, reason: 'notPlanned' });
  assert.deepEqual(f.actions[1].action, { kind: 'reopenIssue', number: 3 });
});

test('without write access a detail shows no direct actions', async () => {
  const f = await renderSidebar({ issues: [issue(3, { writable: false })], mergeRequests: [mergeRequest(10, { writable: false })] });
  const issueDetail = await f.openIssue(3);
  assert.equal(within(issueDetail).queryByRole('button', { name: /Close as|Reopen/ }), null);
  const requestDetail = await f.openPullRequest(10);
  assert.equal(within(requestDetail).queryByRole('button', { name: /Merge|Close pull request/ }), null);
});

test('a refused action shows the platform\'s words under the buttons with a retry, until dismissed or the next refresh', async () => {
  const f = await renderSidebar({ issues: [issue(3)], mergeRequests: [] });
  const detail = await f.openIssue(3);
  await f.user.click(within(detail).getByRole('button', { name: 'Close as completed' }));
  const refusal = { ok: false, failure: { kind: 'transient', platform: github, output: 'gh: Resource not accessible by integration (closeIssue)' } } as const;
  (await f.nextAction(0)).answer(refusal);
  const line = await within(detail).findByRole('alert');
  assert.equal(line.querySelector('.direct-action-reason')!.textContent, 'gh: Resource not accessible by integration (closeIssue)');
  assert.ok(!(within(detail).getByRole('button', { name: 'Close as completed' }) as HTMLButtonElement).disabled);
  await f.user.click(within(line).getByRole('button', { name: 'Retry' }));
  const retried = await f.nextAction(1);
  assert.deepEqual(retried.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  retried.fail(new Error('Network went away'));
  await waitFor(() => assert.equal(within(detail).getByRole('alert').querySelector('.direct-action-reason')!.textContent, 'Network went away'));
  await f.user.click(within(detail).getByRole('button', { name: 'Dismiss' }));
  await waitFor(() => assert.equal(within(detail).queryByRole('alert'), null));

  await f.user.click(within(detail).getByRole('button', { name: 'Close as completed' }));
  (await f.nextAction(2)).answer(refusal);
  await within(detail).findByRole('alert');
  await f.user.click(within(detail).getByRole('button', { name: 'Close detail' }));
  const reopened = await f.openIssue(3);
  assert.equal(within(reopened).queryByRole('alert'), null, 'a fresh read clears the failure');

  await f.user.click(within(reopened).getByRole('button', { name: 'Close as completed' }));
  (await f.nextAction(3)).answer(refusal);
  await within(reopened).findByRole('alert');
  const listReads = f.reads.issuePage;
  await f.user.click(within(f.sidebar()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => assert.equal(f.reads.issuePage, listReads + 1));
  await waitFor(() => assert.equal(within(reopened).queryByRole('alert'), null, 'a sidebar refresh clears the failure'));
});

test('a CLI found missing or signed out while acting fills the sidebar with its state', async () => {
  const f = await renderSidebar({ issues: [issue(3)], mergeRequests: [] });
  const detail = await f.openIssue(3);
  await f.user.click(within(detail).getByRole('button', { name: 'Close as completed' }));
  (await f.nextAction(0)).answer({ ok: false, failure: { kind: 'signedOut', platform: github, output: 'gh auth login' } });
  await within(f.sidebar()).findByRole('button', { name: 'Copy gh auth login' });
  assert.equal(screen.queryByRole('region', { name: 'Issue #3' }), null, 'the detail closes');
  assert.equal(within(f.sidebar()).queryByRole('tab', { name: 'Issues' }), null, 'the state takes the whole content area');
  await f.user.click(within(f.sidebar()).getByRole('button', { name: 'Retry' }));
  await within(f.sidebar()).findByRole('listitem', { name: '#3 Issue 3' });
});

test('merging takes two clicks in place with the method chosen from the allowed ones, remembered for the next pull request', async () => {
  const f = await renderSidebar({ issues: [], mergeRequests: [mergeRequest(10, { merge: mergeState({ methods: ['squash', 'rebase'] }) }), mergeRequest(11)] });
  const detail = await f.openPullRequest(10);
  await f.user.click(within(detail).getByRole('button', { name: 'Merge methods' }));
  const methods = within(detail).getByRole('menu', { name: 'Merge methods' });
  assert.deepEqual(within(methods).getAllByRole('menuitemradio').map(item => item.textContent), ['Squash and merge', 'Rebase and merge']);
  await f.user.click(within(methods).getByRole('menuitemradio', { name: 'Rebase and merge' }));
  await f.user.click(within(detail).getByRole('button', { name: 'Rebase and merge' }));
  assert.equal(f.actions.length, 0, 'the first click only asks to confirm');
  assert.equal(document.querySelector('dialog'), null, 'no dialog opens');
  await f.user.click(within(detail).getByRole('button', { name: 'Confirm merge' }));
  assert.deepEqual((await f.nextAction(0)).action, { kind: 'mergeMergeRequest', number: 10, method: 'rebase' });
  f.actions[0].answer({ ok: true });
  await within(detail).findByRole('button', { name: 'Rebase and merge' });

  const other = await f.openPullRequest(11);
  assert.ok(within(other).getByRole('button', { name: 'Rebase and merge' }), 'the last method chosen is offered first');
  await f.user.click(within(other).getByRole('button', { name: 'Close pull request' }));
  assert.deepEqual((await f.nextAction(1)).action, { kind: 'closeMergeRequest', number: 11 });
});

test('a blocked merge is greyed out with its reasons, and a merge queue or auto-merge sends the user to the platform', async () => {
  const f = await renderSidebar({ issues: [], mergeRequests: [
    mergeRequest(10, { draft: true, merge: mergeState({ review: 'reviewRequired', conflicting: true, checks: [
      { name: 'build', conclusion: 'failing', required: true, url: null }, { name: 'lint', conclusion: 'failing', required: false, url: null }] }) }),
    mergeRequest(11, { merge: mergeState({ mergeThrough: 'mergeQueue' }) }),
    mergeRequest(12, { merge: mergeState({ mergeThrough: 'autoMerge' }) }),
  ] });
  // The method a test before chose is still remembered: the app has not quit.
  const mergeButton = { name: /^(Create a merge commit|Squash and merge|Rebase and merge)$/ };
  const blocked = await f.openPullRequest(10);
  assert.ok((within(blocked).getByRole('button', mergeButton) as HTMLButtonElement).disabled);
  assert.deepEqual(within(within(blocked).getByRole('list', { name: 'Why it cannot merge' })).getAllByRole('listitem').map(item => item.textContent),
    ['This pull request is still a draft', 'This branch has conflicts that must be resolved', 'A required review is missing', 'Required checks have not passed']);
  assert.ok(!(within(blocked).getByRole('button', { name: 'Close pull request' }) as HTMLButtonElement).disabled, 'closing stays possible');

  const queued = await f.openPullRequest(11);
  assert.ok((within(queued).getByRole('button', mergeButton) as HTMLButtonElement).disabled);
  assert.ok(within(queued).getByText('This repository merges through a merge queue; merge it on GitHub.'));
  assert.equal(within(queued).getByRole('link', { name: 'Open in browser ↗' }).getAttribute('href'), 'https://github.com/octo/app/pull/11');

  const autoMerged = await f.openPullRequest(12);
  assert.ok((within(autoMerged).getByRole('button', mergeButton) as HTMLButtonElement).disabled);
  assert.ok(within(autoMerged).getByText('This pull request merges only through auto-merge; merge it on GitHub.'));
  assert.equal(within(autoMerged).getByRole('link', { name: 'Open in browser ↗' }).getAttribute('href'), 'https://github.com/octo/app/pull/12');
});

test('a closed pull request can be reopened and a merged one offers no action', async () => {
  const f = await renderSidebar({ issues: [], mergeRequests: [mergeRequest(10, { state: 'closed' }), mergeRequest(11, { state: 'merged' })] });
  const closed = await f.openPullRequest(10);
  await f.user.click(within(closed).getByRole('button', { name: 'Reopen' }));
  assert.deepEqual((await f.nextAction(0)).action, { kind: 'reopenMergeRequest', number: 10 });
  const merged = await f.openPullRequest(11);
  assert.equal(within(merged).queryByRole('button', { name: /Reopen|Merge|Close pull request/ }), null);
});
