import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Settings, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { ForgeCapabilities, IssueDetail, IssueDetailResult, IssueReference, ListedIssue } from '../../app/shared/forge';
import { stubLayoutApis } from './support/no-layout';
import { deferred, provideWorkbench } from './support/workbench';
import { githubCapabilities, githubForge, githubView } from './support/forge';
import { issue as listedIssue } from './support/issue-list';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const repositoryUrl = 'https://github.com/octo/alpha';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
const summary = (number: number, extra: Partial<ListedIssue> = {}): ListedIssue => listedIssue(number, { createdAt: hoursAgo(3), ...extra });
const reference = (number: number, extra: Partial<IssueReference> = {}): IssueReference => ({
  number, title: `Issue ${number}`, state: 'open', closedAs: null, url: `${repositoryUrl}/issues/${number}`, ...extra,
});
const detail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({
  ...summary(number), url: `${repositoryUrl}/issues/${number}`, author: 'mona', assignees: [], body: '', comments: [], commentCount: 0,
  parent: null, subIssues: [], blockedBy: [], blocking: [], closingPullRequests: [],
  issueLinks: `${repositoryUrl}/issues/`, ...extra,
});

interface Request { number: number; answer(result: IssueDetailResult): void; fail(error: Error): void }

/** The Workbench with a bound project, its sidebar open on one page of issues. Every detail request waits until the test answers it. */
function renderWorkbench(issues: ListedIssue[], capabilities: ForgeCapabilities = githubCapabilities, settings: Partial<Settings> = {}) {
  const project: ProjectView = {
    id: 'alpha', name: 'Alpha', directory: '/work/alpha', layout: { panel: 'panel' }, tray: [], repository: { forge: 'github', path: 'octo/alpha' }, ...githubView, capabilities,
    panels: [{ id: 'panel', agent: 'codex', run: { id: 'run', panelId: 'panel', projectId: 'alpha', state: 'running', title: 'Alpha session' } }],
  };
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: true, width: 380 }, activeProjectId: 'alpha', settings: { ...defaultSettings(), ...settings },
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [project],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const requests: Request[] = [];
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveSidebar: async () => {}, activateProject: async () => {}, saveLayout: async () => {},
    issuePage: async () => ({ ok: true, issues, cursor: null, labels: [], counts: { open: issues.length, closed: 0 } }),
    issueDetail: (projectId, number) => {
      assert.equal(projectId, 'alpha');
      const answer = deferred<IssueDetailResult>();
      requests.push({ number, answer: answer.resolve, fail: answer.reject });
      return answer.promise;
    },
  });
  render(<App />);
  const request = (count: number) => waitFor(() => { assert.equal(requests.length, count, 'detail requests made'); return requests[count - 1]; });
  return { user: userEvent.setup(), request };
}

const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const pane = () => within(sidebar()).getByRole('region', { name: 'Issue detail' });
const row = (title: string) => waitFor(() => within(sidebar()).getByRole('button', { name: title }));

test('clicking a row opens its detail beside the list, with the author, comment count and assignees, and closing it returns to the list alone', async () => {
  const { user, request } = renderWorkbench([summary(7, { title: 'Issue detail' }), summary(6)]);
  await user.click(await row('Issue detail'));
  const first = await request(1);
  assert.equal(first.number, 7);
  assert.ok(within(pane()).getByText('Loading #7…'));
  first.answer({ ok: true, issue: detail(7, { title: 'Issue detail', state: 'closed', closedAs: 'completed', assignees: ['octo', 'hubot'], commentCount: 2,
    body: '<p>The body.</p>', comments: [{ author: 'hubot', createdAt: hoursAgo(1), html: '<p>Resolution: overlay.</p>' }, { author: null, createdAt: hoursAgo(1), html: '<p>Ghost.</p>' }] }) });
  await within(pane()).findByRole('heading', { name: 'Issue detail #7' });
  assert.ok(within(pane()).getByText('Completed'), 'the state pill names how it was closed');
  const meta = within(pane()).getByText(/opened/).closest('.forge-doc-meta')!;
  assert.match(meta.textContent!, /mona opened 3h ago · 2 comments · Assignees: octo, hubot/);
  assert.ok(within(pane()).getByText('The body.'));
  assert.ok(within(pane()).getByText('Resolution: overlay.'));
  assert.ok(within(pane()).getByText('Deleted user'), 'a comment from a deleted account names no one');
  assert.equal(within(pane()).getByRole('link', { name: 'Open on GitHub ↗' }).getAttribute('href'), `${repositoryUrl}/issues/7`);
  assert.equal(within(sidebar()).getAllByRole('listitem').length, 2, 'the list stays visible');
  await user.click(within(pane()).getByRole('button', { name: 'Close' }));
  assert.equal(within(sidebar()).queryByRole('region', { name: 'Issue detail' }), null);
});

test('the body and comments pass the HTML filter, same-repository issue links open in the sidebar, and others go to the browser', async () => {
  const { user, request } = renderWorkbench([summary(7)]);
  await user.click(await row('Issue 7'));
  (await request(1)).answer({ ok: true, issue: detail(7, {
    body: `<p onclick="steal()">See <a class="issue-link" href="https://github.com/Octo/Alpha/issues/3">#3</a>, <a href="https://example.com/doc">the doc</a>
      and <a href="javascript:steal()">this</a>.</p><script>steal()</script><style>p { display: none }</style>
      <img src="https://user-images.githubusercontent.com/shot.png" alt="Screenshot"><a href="https://user-images.githubusercontent.com/linked.png"><img src="https://user-images.githubusercontent.com/linked.png" alt="Linked"></a><iframe src="https://example.com"></iframe>
      <ul><li><input type="checkbox" checked> done</li></ul><g-emoji alias="tada">🎉</g-emoji><form><button>Submit</button></form>`,
    comments: [{ author: 'hubot', createdAt: hoursAgo(1), html: '<p>Merged in <a href="https://github.com/other/repo/issues/3">other/repo#3</a>.</p><img src="x" onerror="steal()">' }],
  }) });
  const body = await within(pane()).findByText(/See/);
  const html = pane().innerHTML;
  for (const unsafe of ['<script', 'steal()', '<style', '<iframe', '<img', '<form', '<button>Submit', 'onclick', 'onerror', 'class="issue-link"']) {
    assert.ok(!html.includes(unsafe), `filtered out: ${unsafe}`);
  }
  assert.equal(body.tagName, 'P');
  assert.equal(within(pane()).getByText('this').getAttribute('href'), null, 'a script link loses its target');
  const external = within(pane()).getByRole('link', { name: 'the doc' });
  assert.deepEqual([external.getAttribute('target'), external.getAttribute('rel')], ['_blank', 'noreferrer']);
  assert.equal(within(pane()).getByRole('link', { name: 'Screenshot ↗' }).getAttribute('href'), 'https://user-images.githubusercontent.com/shot.png', 'an image becomes a link to it');
  assert.equal(within(pane()).getByRole('link', { name: 'Linked ↗' }).getAttribute('href'), 'https://user-images.githubusercontent.com/linked.png');
  assert.equal(pane().querySelector('a a'), null, 'an image the forge already links becomes that link\'s text');
  const checkbox = within(pane()).getByRole<HTMLInputElement>('checkbox');
  assert.ok(checkbox.checked && checkbox.disabled, 'a task list item stays read-only');
  assert.ok(within(pane()).getByText('🎉'));
  assert.equal(within(pane()).getByRole('link', { name: 'other/repo#3' }).getAttribute('target'), '_blank', 'another repository opens in the browser');

  await user.click(within(pane()).getByRole('link', { name: '#3' }));
  const linked = await request(2);
  assert.equal(linked.number, 3, 'a same-repository issue link opens in the sidebar, whatever the case of its path');
  linked.answer({ ok: true, issue: detail(3, { title: 'Linked issue' }) });
  await within(pane()).findByRole('heading', { name: 'Linked issue #3' });
  await user.click(within(pane()).getByRole('button', { name: 'Back' }));
  (await request(3)).answer({ ok: true, issue: detail(7) });
  await within(pane()).findByRole('heading', { name: 'Issue 7 #7' });
  assert.ok(within(pane()).getByRole<HTMLButtonElement>('button', { name: 'Back' }).disabled, 'nothing before the first issue');
});

test('the relation graph draws open blockers and the open issues this one blocks, with the parent above and the sub-issues below', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: true, issue: detail(5, { title: 'Detail',
    parent: { ...reference(1, { title: 'Spec' }), progress: { closed: 1, total: 3 } },
    blockedBy: [reference(2, { title: 'Open blocker' }), reference(3, { title: 'Closed blocker', state: 'closed', closedAs: 'completed' })],
    blocking: [reference(8, { title: 'Waits on detail' })],
    subIssues: [reference(6, { title: 'First part', state: 'closed', closedAs: 'completed' }), reference(9, { title: 'Second part' })],
  }) });
  const graph = await within(pane()).findByRole('group', { name: 'Relations' });
  const column = (name: string) => [...graph.querySelectorAll(`[data-column="${name}"]`)].map(node => node.textContent);
  assert.deepEqual(column('blockedBy'), ['#2Open blocker'], 'only open blockers are drawn');
  assert.deepEqual(column('self'), ['#5Detail']);
  assert.deepEqual(column('blocking'), ['#8Waits on detail']);
  assert.deepEqual([...graph.querySelectorAll('path.forge-edge')].length, 2, 'one edge per blocking relation');
  assert.equal(within(pane()).getByRole('button', { name: /Spec/ }).textContent, 'Spec#11/3', 'the parent shows above, with its sub-issue progress');
  assert.ok(within(pane()).getByLabelText(/Blocked by #2/), 'the head shows the open blockers');
  const subIssues = within(pane()).getByRole('region', { name: 'Sub-issues' });
  assert.ok(within(subIssues).getByText('1/2'), 'the sub-issue progress counts closed ones');
  assert.deepEqual(within(subIssues).getAllByRole('button').map(button => button.textContent), ['First part#6', 'Second part#9']);

  await user.click(within(graph).getByRole('button', { name: /Open blocker/ }));
  assert.equal((await request(2)).number, 2, 'a node opens its issue in the sidebar');
});

test('a closed issue draws no issues it blocks, and an issue with no live relations draws no graph', async () => {
  const { user, request } = renderWorkbench([summary(5), summary(4)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: true, issue: detail(5, { state: 'closed', closedAs: 'completed', blocking: [reference(8)],
    blockedBy: [reference(3, { state: 'closed', closedAs: 'completed' })] }) });
  await within(pane()).findByRole('heading', { name: 'Issue 5 #5' });
  assert.equal(within(pane()).queryByRole('group', { name: 'Relations' }), null);
});

test('relations a forge does not declare are not shown', async () => {
  const { user, request } = renderWorkbench([summary(5)], { subIssues: false, blocking: false });
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: true, issue: detail(5, { parent: { ...reference(1, { title: 'Spec' }), progress: { closed: 0, total: 1 } }, blockedBy: [reference(2)], subIssues: [reference(6)] }) });
  await within(pane()).findByRole('heading', { name: 'Issue 5 #5' });
  assert.equal(within(pane()).queryByRole('group', { name: 'Relations' }), null);
  assert.equal(within(pane()).queryByRole('region', { name: 'Sub-issues' }), null);
  assert.equal(within(pane()).queryByRole('button', { name: /Spec/ }), null);
});

test('the pull requests that close the issue on merge sit in their own block, closed ones included, each with its checks conclusion', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  const pull = (number: number, title: string, state: 'open' | 'draft' | 'merged' | 'closed', checks: 'passed' | 'failed' | 'pending' | 'none') =>
    ({ number, title, state, checks, url: `${repositoryUrl}/pull/${number}` });
  (await request(1)).answer({ ok: true, issue: detail(5, { closingPullRequests: [
    pull(40, 'Passing', 'open', 'passed'), pull(41, 'Running', 'draft', 'pending'), pull(42, 'Failing', 'open', 'failed'),
    pull(43, 'Merged', 'merged', 'passed'), pull(44, 'Abandoned', 'closed', 'failed'), pull(45, 'Unchecked', 'open', 'none'),
  ] }) });
  const block = await within(pane()).findByRole('region', { name: 'Pull requests that close this issue on merge' });
  const items = within(block).getAllByRole('listitem');
  assert.deepEqual(items.map(item => item.textContent), [
    '#40Passing✓ Checks passed', '#41Running● Checks running', '#42Failing✗ Checks failed', '#43Merged', '#44Abandoned', '#45Unchecked',
  ]);
  assert.deepEqual(items.map(item => within(item).getByRole('link').getAttribute('href')), [40, 41, 42, 43, 44, 45].map(n => `${repositoryUrl}/pull/${n}`),
    'each opens in the browser');
  assert.deepEqual(items.map(item => within(item).getByRole('link').getAttribute('target')), Array(6).fill('_blank'));
  assert.deepEqual(items.map(item => within(item).getByRole('img').getAttribute('aria-label')),
    ['Open pull request', 'Draft pull request', 'Open pull request', 'Merged pull request', 'Closed pull request', 'Open pull request']);
  assert.equal(within(pane()).queryByRole('group', { name: 'Relations' }), null, 'pull requests stay out of the issue graph');
});

// The PTY follows the terminal's box, and the terminal fills the layout area: a detail that leaves the layout area's
// classes and styles as they were leaves the PTY its size. The desktop suite shows the squeezing detail resizing it.
test('an overlaying detail leaves the layout area as it was, and a squeezing one narrows it until it closes', async () => {
  for (const detailCoexistence of ['overlay', 'squeeze'] as const) {
    const { user, request } = renderWorkbench([summary(7)], githubCapabilities, { detailCoexistence });
    const layoutArea = () => document.querySelector('.app-body')!;
    const before = [layoutArea().className, layoutArea().getAttribute('style')];
    await user.click(await row('Issue 7'));
    (await request(1)).answer({ ok: true, issue: detail(7) });
    await within(pane()).findByRole('heading', { name: 'Issue 7 #7' });
    if (detailCoexistence === 'overlay') assert.deepEqual([layoutArea().className, layoutArea().getAttribute('style')], before, 'overlay changes nothing the layout area lays out by');
    else assert.ok(layoutArea().classList.contains('forge-detail-squeeze'), 'squeeze narrows the layout area');
    await user.click(within(pane()).getByRole('button', { name: 'Close' }));
    await waitFor(() => assert.deepEqual([layoutArea().className, layoutArea().getAttribute('style')], before, 'closing the detail restores the layout area'));
    cleanup();
  }
});

test('a detail that fails to load says why and Retry asks again', async () => {
  const { user, request } = renderWorkbench([summary(5)]);
  await user.click(await row('Issue 5'));
  (await request(1)).answer({ ok: false, failure: { kind: 'transient', detail: 'HTTP 502: Bad Gateway', forge: githubForge } });
  await within(pane()).findByText('Could not load #5: HTTP 502: Bad Gateway');
  await user.click(within(pane()).getByRole('button', { name: 'Retry' }));
  const again = await request(2);
  assert.equal(again.number, 5);
  again.fail(new Error('No repository bound'));
  await within(pane()).findByText('Could not load #5: No repository bound');
});
