import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import { platformDescriptions, type IssueDetail, type IssueDetailResult, type MergeRequestDetail, type MergeRequestDetailResult, type MergeRequestSummary,
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

const app: ProjectView = { id: 'app', name: 'App project', directory: '/work/app', layout: null, panels: [], tray: [], dispatches: [],
  repository: { platform: 'github', path: 'octo/app' } };

const summary = (number: number): MergeRequestSummary => ({ number, title: `Change ${number}`, state: 'open', draft: false, author: 'mona',
  createdAt: '2026-11-01T00:00:00Z', checks: null, labels: [], url: `https://github.com/octo/app/pull/${number}` });
const mergeState = (extra: Partial<MergeState> = {}): MergeState => ({ review: null, checks: [], conflicting: false, methods: ['merge'], mergeThrough: null, ...extra });
const detail = (number: number, extra: Partial<MergeRequestDetail> = {}): MergeRequestDetail => {
  const { checks: _checks, ...rest } = summary(number);
  return { ...rest, head: 'feature', base: 'main', changesUrl: `https://github.com/octo/app/pull/${number}/files`, body: '<p>Body</p>',
    comments: [], reviews: [], closingIssues: [], merge: mergeState(), writable: false, ...extra };
};
const issue = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, author: 'mona', assignees: [], body: '<p>Issue body</p>',
  commentCount: 0, comments: [], parent: null, subIssues: [], blockedBy: [], blocking: [], closingMergeRequests: [], writable: false, ...extra });

interface Read<Result> { number: number; answer(result: Result): void }

/** The workbench with the sidebar open on the App project, listing issue #3 and pull requests #10 and #11; each detail read waits for the test to answer it. */
async function renderSidebar() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: true, width: 420 }, activeProjectId: app.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [app],
  };
  const mergeRequestReads: Read<MergeRequestDetailResult>[] = [];
  const issueReads: Read<IssueDetailResult>[] = [];
  const opened: string[] = [];
  window.open = ((url: string) => { opened.push(url); return null; }) as typeof window.open;
  const reading = <Result,>(reads: Read<Result>[]) => (_projectId: string, number: number) => {
    const reply = deferred<Result>();
    reads.push({ number, answer: reply.resolve });
    return reply.promise;
  };
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, ready: async () => {}, activateProject: async () => {},
    saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    issuePage: async () => ({ ok: true, page: { issues: [{ number: 3, title: 'Issue 3', state: 'open', closedAs: null, createdAt: '2026-11-01T00:00:00Z',
      labels: [], url: 'https://github.com/octo/app/issues/3', parent: null, subIssues: null, blockedBy: [], moreBlockers: 0 }], next: null, labels: [] } }),
    mergeRequestPage: async () => ({ ok: true, page: { mergeRequests: [summary(11), summary(10)], next: null, labels: [] } }),
    issueDetail: reading(issueReads), mergeRequestDetail: reading(mergeRequestReads) });
  render(<App />);
  const user = userEvent.setup();
  const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
  await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('listitem', { name: '#3 Issue 3' });
  const next = async <Result,>(reads: Read<Result>[], count: number) => {
    await waitFor(() => assert.ok(reads.length > count, `read ${count + 1}`));
    return reads[count];
  };
  /** Opens the pull request's row on the Pull requests tab and answers its detail read. */
  const openPullRequest = async (shown: MergeRequestDetail) => {
    await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
    const count = mergeRequestReads.length;
    await user.click(await within(sidebar()).findByText(`Change ${shown.number}`));
    const read = await next(mergeRequestReads, count);
    assert.equal(read.number, shown.number);
    read.answer({ ok: true, mergeRequest: shown });
    return screen.findByRole('region', { name: `Pull request #${shown.number}` });
  };
  return { user, sidebar, mergeRequestReads, issueReads, next, openPullRequest, opened };
}

test('a pull request row opens its detail, whose header leads with title, state, branches, the changes link, labels and the issues it closes', async () => {
  const { user, sidebar, openPullRequest, issueReads, next } = await renderSidebar();
  const shown = await openPullRequest(detail(10, { title: 'Fix the bug', head: 'fork:fix', base: 'main', labels: [{ name: 'bug', color: 'd73a4a' }],
    closingIssues: [{ number: 3, title: 'Issue 3', state: 'open', closedAs: null, repository: { platform: 'github', path: 'octo/app' }, url: 'https://github.com/octo/app/issues/3' }] }));
  assert.equal(within(sidebar()).getByRole('listitem', { name: '#10 Change 10' }).getAttribute('aria-current'), 'true');
  const header = shown.querySelector('.merge-request-header')!;
  assert.deepEqual([...header.children].map(part => part.className), ['issue-detail-title', 'issue-detail-meta', 'issue-detail-labels', 'merge-request-closes']);
  assert.ok(within(shown).getByRole('heading', { name: /Fix the bug/ }));
  assert.ok(within(shown).getByRole('img', { name: 'Open' }));
  assert.ok(within(shown).getByText('fork:fix → main'));
  assert.equal(within(shown).getByRole('link', { name: 'View changes on GitHub ↗' }).getAttribute('href'), 'https://github.com/octo/app/pull/10/files');
  assert.ok(within(shown).getByText('bug'));
  await user.click(within(shown).getByRole('button', { name: '#3 Issue 3' }));
  const read = await next(issueReads, 0);
  assert.equal(read.number, 3);
  read.answer({ ok: true, issue: issue(3) });
  assert.ok(await screen.findByRole('region', { name: 'Issue #3' }), 'the closed issue opens in the sidebar');
});

test('the body, comments and review summaries follow in time order, and line comments are only counted with a link to the platform', async () => {
  const { openPullRequest } = await renderSidebar();
  const shown = await openPullRequest(detail(10, {
    body: '<p>The body</p>',
    comments: [{ author: 'hubot', createdAt: '2026-11-02T00:00:00Z', body: '<p>Early comment</p>' }, { author: 'hubot', createdAt: '2026-11-05T00:00:00Z', body: '<p>Late comment</p>' }],
    reviews: [
      { author: 'octo', state: 'changesRequested', submittedAt: '2026-11-03T00:00:00Z', body: '<p>Rename it</p>', codeComments: 2, url: 'https://github.com/octo/app/pull/10#pullrequestreview-1' },
      { author: 'mona', state: 'approved', submittedAt: '2026-11-04T00:00:00Z', body: '', codeComments: 0, url: 'https://github.com/octo/app/pull/10#pullrequestreview-2' },
      { author: 'hubot', state: 'commented', submittedAt: '2026-11-06T00:00:00Z', body: '', codeComments: 1, url: 'https://github.com/octo/app/pull/10#pullrequestreview-3' },
    ],
  }));
  const cards = [...shown.querySelectorAll('.issue-detail-card')].map(card => card.textContent!.replace(/\s+/g, ' '));
  assert.equal(cards.length, 6);
  for (const [index, text] of ['The body', 'Early comment', 'octo requested changes', 'mona approved', 'Late comment', 'hubot reviewed'].entries()) {
    assert.ok(cards[index].includes(text), `${index}: ${cards[index]}`);
  }
  assert.equal(within(shown).getByRole('link', { name: '2 code comments ↗' }).getAttribute('href'), 'https://github.com/octo/app/pull/10#pullrequestreview-1');
  assert.equal(within(shown).getByRole('link', { name: '1 code comment ↗' }).getAttribute('href'), 'https://github.com/octo/app/pull/10#pullrequestreview-3');
  assert.equal(within(shown).queryByRole('button', { name: /approve/i }), null, 'there is no approve button');
});

test('the merge area lists the review state, then checks with failing and running ones itemised and passed ones folded, then conflicts and draft', async () => {
  const { user, openPullRequest } = await renderSidebar();
  const shown = await openPullRequest(detail(10, { draft: true, merge: mergeState({ review: 'changesRequested', conflicting: true, checks: [
    { name: 'build', conclusion: 'failing', required: true, url: 'https://ci.example/build' },
    { name: 'lint', conclusion: 'pending', required: false, url: 'https://ci.example/lint' },
    { name: 'docs', conclusion: 'passing', required: false, url: 'https://ci.example/docs' },
    { name: 'deploy', conclusion: 'passing', required: true, url: null },
  ] }) }));
  const area = within(shown).getByRole('region', { name: 'Merge status' });
  assert.deepEqual([...area.children].map(part => part.className), ['merge-review merge-review-changesRequested', 'merge-checks', 'merge-conflicts', 'merge-draft']);
  assert.ok(within(area).getByText('Changes requested'));
  assert.ok(within(area).getByText('1 failing, 1 in progress, 2 passed'));
  const listed = within(area).getByRole('list', { name: 'Checks that need attention' });
  assert.deepEqual(within(listed).getAllByRole('listitem').map(item => item.textContent), ['✗buildRequired', '●lint']);
  assert.equal(within(listed).getByRole('link', { name: 'build' }).getAttribute('href'), 'https://ci.example/build');
  const passed = area.querySelector('details')!;
  assert.equal(passed.open, false, 'passed checks are folded');
  await user.click(within(area).getByText('Passed checks (2)'));
  assert.deepEqual(within(within(area).getByRole('list', { name: 'Passed checks (2)' })).getAllByRole('listitem').map(item => item.textContent), ['✓docs', '✓deployRequired']);
  assert.equal(within(area).getByRole('link', { name: 'docs' }).getAttribute('href'), 'https://ci.example/docs');
  assert.ok(within(area).getByText('This branch has conflicts that must be resolved'));
  assert.ok(within(area).getByText('This pull request is still a draft'));
});

test('the merge area names each review decision, leaves out what does not apply, and marks required checks only when the platform has them', async () => {
  for (const [review, text] of [['approved', 'Approved'], ['reviewRequired', 'Review required']] as const) {
    const { openPullRequest } = await renderSidebar();
    const shown = await openPullRequest(detail(10, { merge: mergeState({ review }) }));
    const area = within(shown).getByRole('region', { name: 'Merge status' });
    assert.deepEqual([...area.children].map(part => part.textContent), [text], 'no checks, conflicts or draft to tell');
    cleanup();
  }
  const capabilities = platformDescriptions.github.capabilities;
  platformDescriptions.github.capabilities = capabilities.filter(capability => capability !== 'requiredChecks');
  try {
    const { openPullRequest } = await renderSidebar();
    const shown = await openPullRequest(detail(10, { merge: mergeState({ checks: [{ name: 'build', conclusion: 'failing', required: true, url: null }] }) }));
    const area = within(shown).getByRole('region', { name: 'Merge status' });
    assert.equal(within(area).queryByText('Required'), null);
    assert.ok(within(area).getByText('build'), 'a check without a log is not a link');
    assert.equal(within(area).queryByRole('link', { name: 'build' }), null);
  } finally { platformDescriptions.github.capabilities = capabilities; }
  cleanup();
  const { openPullRequest } = await renderSidebar();
  const merged = await openPullRequest(detail(10, { state: 'merged', merge: mergeState({ review: 'approved', conflicting: true }) }));
  assert.equal(within(merged).queryByRole('region', { name: 'Merge status' }), null, 'a merged pull request has no merge area');
});

test('a closing pull request in an issue detail opens in the sidebar, and same-repository links in either detail open there too', async () => {
  const { user, sidebar, issueReads, mergeRequestReads, next, opened } = await renderSidebar();
  await user.click(within(within(sidebar()).getByRole('listitem', { name: '#3 Issue 3' })).getByText('Issue 3'));
  (await next(issueReads, 0)).answer({ ok: true, issue: issue(3, { closingMergeRequests: [
    { number: 10, title: 'Fix', state: 'open', draft: false, checks: null, url: 'https://github.com/octo/app/pull/10' },
    { number: 4, title: 'Elsewhere', state: 'open', draft: false, checks: null, url: 'https://github.com/octo/other/pull/4' },
  ] }) });
  const issueShown = await screen.findByRole('region', { name: 'Issue #3' });
  await user.click(within(issueShown).getByRole('button', { name: '#4 Elsewhere' }));
  assert.deepEqual(opened, ['https://github.com/octo/other/pull/4']);
  await user.click(within(issueShown).getByRole('button', { name: '#10 Fix' }));
  const read = await next(mergeRequestReads, 0);
  assert.equal(read.number, 10);
  read.answer({ ok: true, mergeRequest: detail(10, { body: '<p><a href="https://github.com/octo/app/issues/3">#3</a> <a href="https://github.com/octo/app/pull/11">#11</a></p>' }) });
  const shown = await screen.findByRole('region', { name: 'Pull request #10' });
  await user.click(within(shown).getByRole('link', { name: '#11' }));
  (await next(mergeRequestReads, 1)).answer({ ok: true, mergeRequest: detail(11, { title: 'Linked change' }) });
  const linked = await screen.findByRole('region', { name: 'Pull request #11' });
  assert.ok(within(linked).getByRole('heading', { name: /Linked change/ }));
  await user.click(within(linked).getByRole('button', { name: 'Close detail' }));
  assert.equal(screen.queryByRole('region', { name: 'Pull request #11' }), null);
  assert.equal(opened.length, 1);
});

test('a pull request detail that cannot be read says why and retries on request', async () => {
  const { user, sidebar, mergeRequestReads, next } = await renderSidebar();
  await user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  await user.click(await within(sidebar()).findByText('Change 10'));
  (await next(mergeRequestReads, 0)).answer({ ok: false, failure: { kind: 'unreachable', platform: platformDescriptions.github, output: '' } });
  const shown = await screen.findByRole('region', { name: 'Pull request #10' });
  assert.ok(await within(shown).findByText(/#10 cannot be read/));
  await user.click(within(shown).getByRole('button', { name: 'Retry' }));
  (await next(mergeRequestReads, 1)).answer({ ok: true, mergeRequest: detail(10, { title: 'Read at last' }) });
  assert.ok(await within(shown).findByRole('heading', { name: /Read at last/ }));
});
