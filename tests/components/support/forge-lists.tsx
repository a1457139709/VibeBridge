import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings/settings';
import type { ProjectView, Snapshot, WorkbenchEvent } from '../../../app/shared/model';
import type { DesktopAPI } from '../../../app/shared/api';
import type {
  ForgeCapabilities,
  ListQuery,
  IssuePage,
  IssueSummary,
  ListedIssue,
  ForgeFailure,
  PullRequestSummary,
  Page,
} from '../../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './workbench';
import { githubCapabilities, githubForge, githubView, githubRepository } from './forge';
import { stubLayoutApis } from './no-layout';
import { forgeSidebarData, type ForgeAnswers } from './forge-sidebar-data';

const project = (id: string, name: string, capabilities: ForgeCapabilities): ProjectView => ({
  id,
  name,
  directory: `/work/${id}`,
  layout: { panel: `${id}-panel` },
  tray: [],
  repository: githubRepository(`octo/${id}`),
  ...githubView,
  capabilities,
  panels: [
    {
      id: `${id}-panel`,
      agent: 'codex',
      run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` },
    },
  ],
});
export const bug = { name: 'bug', color: 'd73a4a' },
  docs = { name: 'docs', color: '0075ca' };
export const summary = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
  labels: [],
  blockedBy: [],
  unlistedBlockers: 0,
  ...extra,
});
export const issue = (number: number, extra: Partial<ListedIssue> = {}): ListedIssue => ({
  ...summary(number),
  parent: null,
  subIssues: { closed: 0, total: 0, issues: [] },
  ...extra,
});
export const pullRequest = (number: number, extra: Partial<PullRequestSummary> = {}): PullRequestSummary => ({
  number,
  title: `Change ${number}`,
  state: 'open',
  createdAt: new Date(Date.now() - 2 * 86400e3).toISOString(),
  author: 'mona',
  checks: 'none',
  labels: [],
  ...extra,
});
export const page = <Item = ListedIssue,>(items: Item[], cursor: string | null = null): Page<Item> => ({
  ok: true,
  items,
  nextCursor: cursor,
  labels: [bug, docs],
  counts: { open: 7, closed: 2 },
});
export const failed = (kind: ForgeFailure['kind'], detail = '', account: string | null = null): Page<never> => ({
  ok: false,
  failure: { kind, detail, forge: githubForge },
  account,
});

/** The size of the sidebar's scrolled rows, which the test DOM does not lay out: how tall the scroll area is, and each
 * row in it. A test sets them; they start tall enough to show every row a test lists. */
export const listGeometry = { viewport: 10_000, row: 40 };
const scrollTops = new WeakMap<Element, number>();
/** Lays out the sidebar's scroll area and its rows by `listGeometry`; any other element keeps the test DOM's no layout. */
function stubListGeometry() {
  const { prototype } = window.HTMLElement;
  const scrollArea = (element: Element) => element.matches('.forge-scroll');
  Object.defineProperties(prototype, {
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return scrollArea(this) ? listGeometry.viewport : 0;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.matches('.forge-rows > li') ? listGeometry.row : 0;
      },
    },
    scrollTop: {
      configurable: true,
      get(this: HTMLElement) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: HTMLElement, value: number) {
        scrollTops.set(this, value);
      },
    },
  });
}

/** The browser APIs the Workbench needs that the test DOM lacks. */
export function stubSidebarApis() {
  stubLayoutApis();
  stubListGeometry();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
}

/** A list page the main process asks the forge for; `list` names the list it is for. */
interface Request {
  list: 'issues' | 'pullRequests';
  projectId: string;
  query: ListQuery;
  answer(page: IssuePage | Page<PullRequestSummary>): void;
  fail(error: Error): void;
}

/** The Workbench with two bound projects and the sidebar open. The sidebar's data is the main process's own module, and
 * every list page it asks the forge for waits until the test answers it. `api` adds or replaces Workbench calls and
 * forge answers; `forge` holds the forge answers, for a test to change as it goes; `publish` sends the snapshot as the
 * test changed it. */
export function renderWorkbench(capabilities = githubCapabilities, api: Partial<DesktopAPI> & ForgeAnswers = {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: true, width: 380 },
    activeProjectId: 'alpha',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [project('alpha', 'Alpha', capabilities), project('beta', 'Beta', capabilities)],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => {
    for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
  };
  const requests: Request[] = [];
  const listRequest = (list: Request['list'], projectId: string, query: ListQuery) => {
    const answer = deferred<IssuePage | Page<PullRequestSummary>>();
    requests.push({ list, projectId, query: structuredClone(query), answer: answer.resolve, fail: answer.reject });
    return answer.promise;
  };
  const {
    issuePage,
    pullRequestPage,
    fetchRepositoryChoices: repositoryChoices,
    issueDetail,
    pullRequestDetail,
    ...calls
  } = api;
  const forge: ForgeAnswers = {
    repositoryChoices:
      repositoryChoices ??
      (async () => ({
        ok: true,
        forge: githubForge,
        account: 'octo',
        origin: null,
        repositories: [githubRepository('octo/alpha')],
      })),
    issuePage: issuePage ?? ((projectId, query) => listRequest('issues', projectId, query) as Promise<IssuePage>),
    pullRequestPage:
      pullRequestPage ??
      ((projectId, query) => listRequest('pullRequests', projectId, query) as Promise<Page<PullRequestSummary>>),
    issueDetail,
    pullRequestDetail,
  };
  const sidebarCalls = forgeSidebarData(forge, event => {
    for (const listener of listeners) listener(event);
  });
  /** The numbers of the rows the sidebar declared it renders, the latest last. */
  const shownRows: number[][] = [];
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    saveSidebar: async (sidebar, preferences) => {
      snapshot[sidebar] = preferences;
      publish();
    },
    activateProject: async id => {
      snapshot.activeProjectId = id;
      publish();
    },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    ...sidebarCalls,
    showForgeRows: (projectId, numbers) => {
      shownRows.push(numbers);
      return sidebarCalls.showForgeRows(projectId, numbers);
    },
    ...calls,
  });
  render(<App />);
  /** The latest request, once it is made. */
  const request = (count: number) =>
    waitFor(() => {
      assert.equal(requests.length, count, 'requests made');
      return requests[count - 1];
    });
  return { user: userEvent.setup(), requests, request, snapshot, publish, forge, shownRows };
}

export const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
export const refresh = () => within(sidebar()).getByRole('button', { name: 'Refresh' });
export const rows = () =>
  within(sidebar())
    .queryAllByRole('listitem')
    .map(row => row.querySelector('.forge-row-title')!.textContent);
export const openNoFilter = { search: '', state: 'open', labels: [] };
