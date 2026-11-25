import assert from 'node:assert/strict';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../../app/renderer/Workbench';
import { defaultSettings } from '../../../app/shared/settings/settings';
import type { SidebarPreferences, ProjectView, Snapshot, WorkbenchEvent } from '../../../app/shared/model';
import type { RepositoryChoices } from '../../../app/shared/forge/forge';
import type { DesktopAPI } from '../../../app/shared/api';
import { provideWorkbench } from './workbench';
import { forgeSidebarData, type ForgeAnswers } from './forge-sidebar-data';
import { testForge, testForgeView, testForgeRepository } from './forge';
import { requireValue } from '../../../app/renderer/common/required';
import { requireInstance, selectElement } from './elements';
import { t } from './localization';
import { queryForgeSidebar } from './sidebar-queries';

const project = (id: string, name: string, repository: ProjectView['repository']): ProjectView => ({
  id,
  name,
  directory: `/work/${id}`,
  layout: { panel: `${id}-panel` },
  tray: [],
  repository,
  ...testForgeView,
  panels: [
    {
      id: `${id}-panel`,
      agent: 'codex',
      run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` },
    },
  ],
});

export function renderWorkbench(
  forgeSidebar: SidebarPreferences = { visible: false, width: 380 },
  api: Partial<DesktopAPI> & ForgeAnswers = {},
) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar,
    activeProjectId: 'bound',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [
      project('bound', boundProject, testForgeRepository('ada/bound')),
      project('unbound', unboundProject, null),
    ],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => {
    for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
  };
  const saved: SidebarPreferences[] = [];
  const choices: RepositoryChoices = {
    ok: true,
    forge: testForge,
    account: 'ada',
    origin: null,
    repositories: [testForgeRepository('ada/unbound')],
  };
  const { fetchRepositoryChoices: repositoryChoices, ...calls } = api;
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
      if (sidebar === 'forgeSidebar') saved.push(preferences);
      snapshot[sidebar] = preferences;
      publish();
    },
    activateProject: async id => {
      snapshot.activeProjectId = id;
      publish();
    },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
    ...forgeSidebarData(
      {
        repositoryChoices: repositoryChoices ?? (async () => choices),
        issuePage: () => new Promise(() => {}),
      },
      event => {
        for (const listener of listeners) listener(event);
      },
    ),
    ...calls,
  });
  render(<App />);
  return { user: userEvent.setup(), saved, snapshot, publish };
}

export const boundProject = 'Bound project',
  unboundProject = 'Unbound project';
export const showSidebar = t('openForgeSidebar', { forge: testForge.name }),
  hideSidebar = t('closeForgeSidebar', { forge: testForge.name });
export const shownSidebar = () =>
  waitFor(() => {
    const element = queryForgeSidebar();
    assert.ok(element, 'the sidebar is shown');
    return element;
  });
export const openedSidebar = () => requireValue(queryForgeSidebar(), 'the opened sidebar');
export const toggle = () => requireInstance(selectElement('.system-bar').lastElementChild, HTMLButtonElement);
export const bindButton = (root: HTMLElement) =>
  requireInstance(within(root).getByRole('button', { name: t('bind') }), HTMLButtonElement);
