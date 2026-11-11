import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { IssueSidebarPreferences, PanelView, ProjectView, Snapshot } from '../../app/shared/model';
import type { DispatchLocation } from '../../app/shared/dispatch';
import type { IssueDetail, IssueDetailResult, IssuePageResult, IssueSummary, RepositoryChoices } from '../../app/shared/code-hosting';
import { provideWorkbench } from './support/workbench';

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

const issue = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [], ...extra });
const detail = (number: number): IssueDetail => ({ ...issue(number), parent: null, subIssues: [], blockedBy: [], author: 'mona', assignees: [],
  body: '<p>Body of the issue with <a href="https://example.com/spec">a link</a></p>', commentCount: 0, comments: [], blocking: [], closingMergeRequests: [] });

/** Issue #10 has open sub-issues #11 and #12; #20 and #30 stand alone. */
const issues = [issue(30), issue(20), issue(10, { subIssues: { completed: 0, total: 2, issues: [issue(12, { parent: 10 }), issue(11, { parent: 10 })] } })];

/** The workbench on `project` bound to octo/app, listing `issues`; details answer at once. */
async function renderWorkbench(issueSidebar: IssueSidebarPreferences = { visible: true, width: 420 }, project = app) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar, activeProjectId: project.id, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [project],
  };
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {},
    ready: async () => {}, activateProject: async () => {}, saveNavigation: async () => {}, saveLayout: async () => {}, saveIssueSidebar: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }), repositoryChoices: () => new Promise<RepositoryChoices>(() => {}),
    issuePage: async (): Promise<IssuePageResult> => ({ ok: true, page: { issues, next: null, labels: [] } }),
    issueDetail: async (_projectId, number): Promise<IssueDetailResult> => ({ ok: true, issue: detail(number) }) });
  render(<App />);
  if (issueSidebar.visible) await screen.findByRole('listitem', { name: '#30 Issue 30' });
  return { user: userEvent.setup() };
}
const row = (number: number) => screen.getByRole('listitem', { name: `#${number} Issue ${number}` });
const focused = (number: number) => waitFor(() => assert.ok(document.activeElement === row(number), `focus on #${number}`));

test('the list moves with the arrow keys, expands sub-issues to the left and climbs back to the parent to the right', async () => {
  const { user } = await renderWorkbench();
  act(() => row(30).focus());
  await user.keyboard('{ArrowUp}');
  await focused(30);
  await user.keyboard('{ArrowDown}{ArrowDown}');
  await focused(10);
  await user.keyboard('{ArrowDown}');
  await focused(10);

  await user.keyboard('{ArrowLeft}');
  await waitFor(() => assert.ok(within(row(10)).getByRole('list', { name: 'Sub-issues of #10' })));
  await focused(10);
  await user.keyboard('{ArrowLeft}');
  await focused(11);
  await user.keyboard('{ArrowDown}');
  await focused(12);
  await user.keyboard('{ArrowDown}');
  await focused(12);
  await user.keyboard('{ArrowRight}');
  await focused(10);
  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(within(row(10)).queryByRole('list'), null));
  await focused(10);
  await user.keyboard('{ArrowUp}{ArrowRight}');
  await focused(20);
  await user.keyboard('{ArrowLeft}');
  await focused(20);

  await user.keyboard('{Escape}');
  await focused(20);
  assert.equal(screen.queryByRole('region', { name: /^Issue #/ }), null);
});

test('Space or Enter opens the detail with focus inside; arrows scroll it, Tab reaches its links, and → or Escape return to the row', async context => {
  const { user } = await renderWorkbench();
  // jsdom has no layout to scroll; record what the detail asks to scroll instead.
  const scrolled: number[] = [];
  const prototype = window.HTMLElement.prototype;
  const scrollBy = prototype.scrollBy;
  prototype.scrollBy = function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (this.classList.contains('issue-detail-scroll') && typeof options === 'object') scrolled.push(options.top ?? 0);
  } as typeof scrollBy;
  context.after(() => { prototype.scrollBy = scrollBy; });
  act(() => row(20).focus());
  await user.keyboard(' ');
  const shown = await screen.findByRole('region', { name: 'Issue #20' });
  await waitFor(() => assert.ok(shown.contains(document.activeElement), 'focus enters the detail'));
  const link = await within(shown).findByRole('link', { name: 'a link' });
  await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
  assert.deepEqual(scrolled.map(Math.sign), [1, 1, -1]);
  // Tab passes the detail's header link and buttons, never leaving the detail, before it reaches the body's link.
  for (let step = 0; step < 6 && document.activeElement !== link; step++) {
    await user.tab();
    assert.ok(shown.contains(document.activeElement), `Tab ${step + 1} stays in the detail`);
  }
  assert.ok(document.activeElement === link, 'Tab reaches the link in the body');

  await user.keyboard('{ArrowRight}');
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Issue #20' }), null));
  await focused(20);

  await user.keyboard('{ArrowDown}{Enter}');
  const next = await screen.findByRole('region', { name: 'Issue #10' });
  await waitFor(() => assert.ok(next.contains(document.activeElement)));
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Issue #10' }), null));
  await focused(10);
});

test('opening the sidebar by shortcut puts focus on the first row of the list', async () => {
  const { user } = await renderWorkbench({ visible: false, width: 420 });
  await screen.findByRole('button', { name: 'Open issue sidebar' });
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  await screen.findByRole('listitem', { name: '#30 Issue 30' });
  await focused(30);
});

test('locating a dispatched panel from the settings page returns to the workspace', async () => {
  const panel: PanelView = { id: 'worker', agent: 'claude', run: { id: 'run-worker', panelId: 'worker', projectId: app.id, state: 'running', title: 'Session worker' }, status: 'busy' };
  const location: DispatchLocation = { projectId: app.id, panelId: 'worker', runId: 'run-worker', ephemeral: false, status: 'busy', title: 'Session worker' };
  const { user } = await renderWorkbench(undefined, { ...app, layout: { panel: 'worker' }, panels: [panel],
    dispatches: [{ issue: 20, time: '2026-11-01T00:00:00Z', agent: 'claude', text: '/tdd https://github.com/octo/app/issues/20', location }] });
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('heading', { name: 'General settings' });
  await user.click(within(row(20)).getByRole('button', { name: /^Locate the panel of the latest dispatch/ }));
  await waitFor(() => assert.equal(screen.queryByRole('heading', { name: 'General settings' }), null));
  assert.equal(document.querySelector<HTMLElement>('.workbench-page')!.hidden, false);
});
