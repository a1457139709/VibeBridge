import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import { platformDescriptions, type IssueDetail, type IssueDetailResult, type IssuePageResult, type RelatedIssue, type IssueSummary, type RepositoryChoices } from '../../app/shared/code-hosting';
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

const summary = (number: number): IssueSummary => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [], moreBlockers: 0 });
const reference = (number: number, extra: Partial<RelatedIssue> = {}): RelatedIssue => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  repository: { platform: 'github', path: 'octo/app' }, url: `https://github.com/octo/app/issues/${number}`, ...extra });
const detail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => ({ ...summary(number), parent: null, subIssues: [], blockedBy: [], author: 'mona', assignees: [], body: '<p>Body</p>',
  commentCount: 0, comments: [], blocking: [], closingMergeRequests: [], writable: false, ...extra });

interface DetailRequest { projectId: string; number: number; answer(result: IssueDetailResult): void }

/** The workbench with the sidebar open on the App project listing issues #1 to #3; each detail request waits for the test to answer it. */
async function renderSidebar() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: true, width: 420 }, activeProjectId: app.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [app],
  };
  const requests: DetailRequest[] = [];
  const opened: string[] = [];
  window.open = ((url: string) => { opened.push(url); return null; }) as typeof window.open;
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {},
    ready: async () => {}, activateProject: async () => {}, saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    issuePage: async (): Promise<IssuePageResult> => ({ ok: true, page: { issues: [summary(3), summary(2), summary(1)], next: null, labels: [] } }),
    issueDetail: (projectId, number) => {
      const reply = deferred<IssueDetailResult>();
      requests.push({ projectId, number, answer: reply.resolve });
      return reply.promise;
    } });
  render(<App />);
  const user = userEvent.setup();
  await screen.findByRole('listitem', { name: '#3 Issue 3' });
  const request = async (count: number) => { await waitFor(() => assert.ok(requests.length > count, `detail request ${count + 1}`)); return requests[count]; };
  /** Opens the issue's row and answers its detail request. */
  const open = async (number: number, shown: IssueDetail) => {
    const count = requests.length;
    await user.click(within(screen.getByRole('listitem', { name: `#${number} Issue ${number}` })).getByText(`Issue ${number}`));
    const next = await request(count);
    assert.deepEqual([next.projectId, next.number], ['app', number]);
    next.answer({ ok: true, issue: shown });
    return screen.findByRole('region', { name: `Issue #${number}` });
  };
  return { user, requests, request, open, opened };
}

test('clicking an issue row opens its detail beside the list with the author, comment count and assignees', async () => {
  const { user, open } = await renderSidebar();
  const shown = await open(3, detail(3, { title: 'Detail title', author: 'mona', assignees: ['octo', 'hubot'], commentCount: 2,
    comments: [{ author: 'hubot', createdAt: '2026-11-02T00:00:00Z', body: '<p>First comment</p>' }, { author: null, createdAt: '2026-11-03T00:00:00Z', body: '<p>Second comment</p>' }] }));
  assert.ok(within(shown).getByRole('heading', { name: /Detail title/ }));
  assert.ok(within(shown).getByText('mona', { selector: '.issue-detail-meta *' }));
  assert.ok(within(shown).getByText('2 comments'));
  assert.ok(within(shown).getByText('octo, hubot'));
  assert.ok(within(shown).getByText('First comment'));
  assert.ok(within(shown).getByText('Second comment'));
  assert.ok(screen.getByRole('listitem', { name: '#3 Issue 3' }), 'the list stays visible');
  assert.equal(screen.getByRole('listitem', { name: '#3 Issue 3' }).getAttribute('aria-current'), 'true');
  await user.click(within(shown).getByRole('button', { name: 'Close detail' }));
  assert.equal(screen.queryByRole('region', { name: 'Issue #3' }), null);
});

test('the body and comments keep the platform rendering but pass the allowlist filter', async () => {
  const { open } = await renderSidebar();
  const shown = await open(3, detail(3, { body: [
    '<h2 onclick="alert(1)" style="color:red" class="issue-sidebar">Heading</h2>',
    '<script>window.hacked = true</script><style>body { display: none }</style><iframe src="https://evil.example"></iframe>',
    '<p>Text <a href="javascript:alert(1)">bad link</a> <img src="https://example.com/a.png" onerror="alert(1)" alt="picture"> <img src="data:image/png;base64,AAAA" alt="inline"></p>',
    '<ul><li><input type="checkbox" checked disabled onchange="x()"> task</li></ul><table><tr><td align="right">cell</td></tr></table>',
    '<pre><code>code</code></pre><blockquote>quote</blockquote><details><summary>more</summary>hidden</details><custom-tag>kept text</custom-tag>',
  ].join(''), comments: [{ author: 'hubot', createdAt: '2026-11-02T00:00:00Z', body: '<p onmouseover="x()">Comment<script>bad()</script></p>' }] }));
  const html = shown.querySelector('.issue-detail-scroll')!.innerHTML;
  assert.doesNotMatch(html, /script|<style|iframe|onclick|onerror|onchange|onmouseover|javascript:|style=|class="issue-sidebar"|data:image|hacked|display: none/);
  const heading = within(shown).getByRole('heading', { name: 'Heading' });
  assert.equal(heading.tagName, 'H2');
  assert.equal(within(shown).getByText('bad link').hasAttribute('href'), false);
  assert.equal(within(shown).getByRole('img', { name: 'picture' }).getAttribute('src'), 'https://example.com/a.png');
  assert.equal(within(shown).queryByRole('img', { name: 'inline' }), null);
  const box = within(shown).getByRole('checkbox') as HTMLInputElement;
  assert.ok(box.checked && box.disabled);
  assert.equal(within(shown).getByText('cell').getAttribute('align'), 'right');
  for (const text of ['code', 'quote', 'more', 'kept text', 'Comment']) assert.ok(within(shown).getByText(text), text);
  assert.equal(shown.querySelector('custom-tag'), null, 'unknown elements leave only their content');
});

test('links to the same repository open in the sidebar and every other link goes to the system browser', async () => {
  const { user, open, request, requests, opened } = await renderSidebar();
  const shown = await open(3, detail(3, { body: '<p><a href="https://github.com/octo/app/issues/1">#1</a> <a href="https://github.com/Octo/App/pull/7">#7</a> '
    + '<a href="https://github.com/octo/other/issues/2">octo/other#2</a> <a href="https://example.com/docs">docs</a></p>' }));
  await user.click(within(shown).getByRole('link', { name: 'octo/other#2' }));
  await user.click(within(shown).getByRole('link', { name: 'docs' }));
  assert.deepEqual(opened, ['https://github.com/octo/other/issues/2', 'https://example.com/docs']);
  assert.equal(requests.length, 1);
  await user.click(within(shown).getByRole('link', { name: '#1' }));
  const first = await request(1);
  assert.equal(first.number, 1);
  first.answer({ ok: true, issue: detail(1, { title: 'Linked issue' }) });
  const linked = await screen.findByRole('region', { name: 'Issue #1' });
  assert.ok(within(linked).getByRole('heading', { name: /Linked issue/ }));
  assert.equal(opened.length, 2, 'the same-repository issue stays in the sidebar');
});

test('the relation graph draws the parent, sub-issues and blocking issues, and opens a related issue on click', async () => {
  const { user, open, request } = await renderSidebar();
  const shown = await open(3, detail(3, { parent: reference(1, { title: 'Epic' }), subIssues: [reference(4), reference(5, { state: 'closed', closedAs: 'completed' })],
    blockedBy: [reference(2, { title: 'Blocker' })], blocking: [reference(6)] }));
  const graph = within(shown).getByRole('group', { name: 'Relations' });
  const nodes = within(graph).getAllByRole('button').map(node => node.getAttribute('aria-label'));
  assert.deepEqual(nodes, ['Parent: #1 Epic', 'Blocked by: #2 Blocker', 'Sub-issue: #4 Issue 4', 'Sub-issue: #5 Issue 5', 'Blocking: #6 Issue 6']);
  assert.ok(within(graph).getByText('#3'), 'the issue itself sits in the middle');
  assert.equal(graph.querySelectorAll('.relation-edge-blocks').length, 2);
  assert.equal(graph.querySelectorAll('.relation-edge-parent').length, 3);
  await user.click(within(graph).getByRole('button', { name: 'Blocked by: #2 Blocker' }));
  assert.equal((await request(1)).number, 2);
});

test('relations a platform does not declare are not drawn, and an issue without relations has no graph', async () => {
  const capabilities = platformDescriptions.github.capabilities;
  platformDescriptions.github.capabilities = capabilities.filter(capability => capability !== 'nativeBlocking');
  try {
    const { open } = await renderSidebar();
    const shown = await open(3, detail(3, { subIssues: [reference(4)], blockedBy: [reference(2)], blocking: [reference(6)] }));
    const graph = within(shown).getByRole('group', { name: 'Relations' });
    assert.deepEqual(within(graph).getAllByRole('button').map(node => node.getAttribute('aria-label')), ['Sub-issue: #4 Issue 4']);
    platformDescriptions.github.capabilities = [];
    cleanup();
    const again = await renderSidebar();
    const bare = await again.open(3, detail(3, { subIssues: [reference(4)], blockedBy: [reference(2)] }));
    assert.equal(within(bare).queryByRole('group', { name: 'Relations' }), null);
  } finally { platformDescriptions.github.capabilities = capabilities; }
});

test('the merge requests that close the issue are listed with their state and check verdict, closed ones included', async () => {
  const { open } = await renderSidebar();
  const shown = await open(3, detail(3, { closingMergeRequests: [
    { number: 10, title: 'Fix it', state: 'open', draft: false, checks: 'failing', url: 'https://github.com/octo/app/pull/10' },
    { number: 11, title: 'Draft fix', state: 'open', draft: true, checks: 'pending', url: 'https://github.com/octo/app/pull/11' },
    { number: 12, title: 'Merged fix', state: 'merged', draft: false, checks: 'passing', url: 'https://github.com/octo/app/pull/12' },
    { number: 13, title: 'Abandoned fix', state: 'closed', draft: false, checks: null, url: 'https://github.com/octo/app/pull/13' },
  ] }));
  const block = within(shown).getByRole('list', { name: 'Pull requests that close this issue when merged' });
  const items = within(block).getAllByRole('listitem');
  assert.deepEqual(items.map(item => item.className), ['closing-merge-request merge-request-open', 'closing-merge-request merge-request-draft',
    'closing-merge-request merge-request-merged', 'closing-merge-request merge-request-closed']);
  assert.deepEqual(items.map(item => within(item).getAllByRole('img').map(image => image.getAttribute('aria-label'))), [
    ['Open', 'Checks failed'], ['Draft', 'Checks in progress'], ['Merged', 'Checks passed'], ['Closed'],
  ]);
  assert.ok(within(items[0]).getByText('Fix it'));
  assert.ok(within(items[0]).getByText('#10'));
});

test('a detail that cannot be read says why and retries on request', async () => {
  const { user, request, requests } = await renderSidebar();
  await user.click(within(screen.getByRole('listitem', { name: '#2 Issue 2' })).getByText('Issue 2'));
  (await request(0)).answer({ ok: false, failure: { kind: 'transient', platform: platformDescriptions.github, output: 'HTTP 502' } });
  const shown = await screen.findByRole('region', { name: 'Issue #2' });
  assert.ok(await within(shown).findByText('Could not read from GitHub: HTTP 502'));
  await user.click(within(shown).getByRole('button', { name: 'Retry' }));
  (await request(1)).answer({ ok: true, issue: detail(2, { title: 'Read at last' }) });
  assert.ok(await within(shown).findByRole('heading', { name: /Read at last/ }));
  assert.equal(requests.length, 2);
});
