import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings';
import type { ProjectView, Snapshot, WorkbenchEvent } from '../../../app/shared/model';
import type { ForgePresentation, IssueListQuery, IssuePage, IssueSummary, ListedIssue, ForgeFailure } from '../../../app/shared/forge';
import { deferred, provideWorkbench } from './workbench';
import { githubForge } from './forge';

const project = (id: string, name: string, forge: ForgePresentation): ProjectView => ({
  id, name, directory: `/work/${id}`, layout: { panel: `${id}-panel` }, tray: [], repository: { forge: 'github', path: `octo/${id}` }, forge,
  panels: [{ id: `${id}-panel`, agent: 'codex', run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` } }],
});
export const bug = { name: 'bug', color: 'd73a4a' }, docs = { name: 'docs', color: '0075ca' };
export const summary = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({
  number, title: `Issue ${number}`, state: 'open', closedAs: null, createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(), labels: [], blockedBy: [], ...extra,
});
export const issue = (number: number, extra: Partial<ListedIssue> = {}): ListedIssue => ({
  ...summary(number), parent: null, subIssues: { closed: 0, total: 0, issues: [] }, ...extra,
});
export const page = (issues: ListedIssue[], cursor: string | null = null): IssuePage => ({ ok: true, issues, cursor, labels: [bug, docs], counts: { open: 7, closed: 2 } });
export const failed = (kind: ForgeFailure['kind'], detail = '', account: string | null = null): IssuePage => ({ ok: false, failure: { kind, detail, forge: githubForge }, account });

interface Request { projectId: string; query: IssueListQuery; answer(page: IssuePage): void; fail(error: Error): void }

/** The Workbench with two bound projects and the sidebar open. Every issue page request waits until the test answers it. */
export function renderWorkbench(forge = githubForge) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: true, width: 380 }, activeProjectId: 'alpha', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [project('alpha', 'Alpha', forge), project('beta', 'Beta', forge)],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) }); };
  const requests: Request[] = [];
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveSidebar: async (sidebar, preferences) => { snapshot[sidebar] = preferences; publish(); },
    activateProject: async id => { snapshot.activeProjectId = id; publish(); },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async () => ({ ok: true, forge: githubForge, account: 'octo', origin: null, repositories: [{ forge: 'github', path: 'octo/alpha' }] }),
    issuePage: (projectId, query) => {
      const answer = deferred<IssuePage>();
      requests.push({ projectId, query: structuredClone(query), answer: answer.resolve, fail: answer.reject });
      return answer.promise;
    },
  });
  render(<App />);
  /** The latest request, once it is made. */
  const request = (count: number) => waitFor(() => { assert.equal(requests.length, count, 'requests made'); return requests[count - 1]; });
  return { user: userEvent.setup(), requests, request };
}

export const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
export const refresh = () => within(sidebar()).getByRole('button', { name: 'Refresh' });
export const rows = () => within(sidebar()).queryAllByRole('listitem').map(row => row.querySelector('.forge-row-title')!.textContent);
export const openNoFilter = { search: '', state: 'open', labels: [] };
