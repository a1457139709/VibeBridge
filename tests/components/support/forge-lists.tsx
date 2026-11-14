import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings';
import type { ProjectView, Snapshot, WorkbenchEvent } from '../../../app/shared/model';
import type { DesktopAPI } from '../../../app/shared/api';
import type { ForgeCapabilities, ListQuery, IssuePage, IssueSummary, ListedIssue, ForgeFailure, PullRequestSummary, Page } from '../../../app/shared/forge';
import { deferred, provideWorkbench } from './workbench';
import { githubCapabilities, githubForge, githubView } from './forge';
import { stubLayoutApis } from './no-layout';

const project = (id: string, name: string, capabilities: ForgeCapabilities): ProjectView => ({
  id, name, directory: `/work/${id}`, layout: { panel: `${id}-panel` }, tray: [], repository: { forge: 'github', path: `octo/${id}` }, ...githubView, capabilities,
  panels: [{ id: `${id}-panel`, agent: 'codex', run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` } }],
});
export const bug = { name: 'bug', color: 'd73a4a' }, docs = { name: 'docs', color: '0075ca' };
export const summary = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({
  number, title: `Issue ${number}`, state: 'open', closedAs: null, createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(), labels: [], blockedBy: [], unlistedBlockers: 0, ...extra,
});
export const issue = (number: number, extra: Partial<ListedIssue> = {}): ListedIssue => ({
  ...summary(number), parent: null, subIssues: { closed: 0, total: 0, issues: [] }, ...extra,
});
export const pullRequest = (number: number, extra: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number, title: `Change ${number}`, state: 'open', createdAt: new Date(Date.now() - 2 * 86400e3).toISOString(), author: 'mona', checks: 'none', labels: [], ...extra,
});
export const page = <Item = ListedIssue,>(items: Item[], cursor: string | null = null): Page<Item> => ({ ok: true, items, cursor, labels: [bug, docs], counts: { open: 7, closed: 2 } });
export const failed = (kind: ForgeFailure['kind'], detail = '', account: string | null = null): Page<never> => ({ ok: false, failure: { kind, detail, forge: githubForge }, account });

/** The browser APIs the Workbench needs that the test DOM lacks. */
export function stubSidebarApis() {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
}

/** A list page request; `list` names the list it is for. */
interface Request {
  list: 'issues' | 'pullRequests'; projectId: string; query: ListQuery;
  answer(page: IssuePage | Page<PullRequestSummary>): void; fail(error: Error): void;
}

/** The Workbench with two bound projects and the sidebar open. Every list page request waits until the test answers it.
 * `api` adds or replaces Workbench calls; `publish` sends the snapshot as the test changed it. */
export function renderWorkbench(capabilities = githubCapabilities, api: Partial<DesktopAPI> = {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: true, width: 380 }, activeProjectId: 'alpha', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [project('alpha', 'Alpha', capabilities), project('beta', 'Beta', capabilities)],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) }); };
  const requests: Request[] = [];
  const listRequest = (list: Request['list'], projectId: string, query: ListQuery) => {
    const answer = deferred<IssuePage | Page<PullRequestSummary>>();
    requests.push({ list, projectId, query: structuredClone(query), answer: answer.resolve, fail: answer.reject });
    return answer.promise;
  };
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveSidebar: async (sidebar, preferences) => { snapshot[sidebar] = preferences; publish(); },
    activateProject: async id => { snapshot.activeProjectId = id; publish(); },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async () => ({ ok: true, forge: githubForge, account: 'octo', origin: null, repositories: [{ forge: 'github', path: 'octo/alpha' }] }),
    issuePage: (projectId, query) => listRequest('issues', projectId, query) as Promise<IssuePage>,
    pullRequestPage: (projectId, query) => listRequest('pullRequests', projectId, query) as Promise<Page<PullRequestSummary>>,
    ...api,
  });
  render(<App />);
  /** The latest request, once it is made. */
  const request = (count: number) => waitFor(() => { assert.equal(requests.length, count, 'requests made'); return requests[count - 1]; });
  return { user: userEvent.setup(), requests, request, snapshot, publish };
}

export const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
export const refresh = () => within(sidebar()).getByRole('button', { name: 'Refresh' });
export const rows = () => within(sidebar()).queryAllByRole('listitem').map(row => row.querySelector('.forge-row-title')!.textContent);
export const openNoFilter = { search: '', state: 'open', labels: [] };
