import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { SidebarPreferences, ProjectView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { RepositoryChoices } from '../../app/shared/forge';
import { stubLayoutApis } from './support/no-layout';
import { provideWorkbench } from './support/workbench';
import { githubForge } from './support/forge';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  // Switching projects disconnects the workspace from the panel locator, which checks its animation's effect.
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const project = (id: string, name: string, repository: ProjectView['repository']): ProjectView => ({
  id, name, directory: `/work/${id}`, layout: { panel: `${id}-panel` }, tray: [], repository, forge: githubForge,
  panels: [{ id: `${id}-panel`, agent: 'codex', run: { id: `${id}-run`, panelId: `${id}-panel`, projectId: id, state: 'running', title: `${name} session` } }],
});

function renderWorkbench(forgeSidebar: SidebarPreferences = { visible: false, width: 380 }) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar, activeProjectId: 'bound', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [project('bound', 'Bound project', { forge: 'github', path: 'octo/bound' }), project('unbound', 'Unbound project', null)],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const publish = () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) }); };
  const saved: SidebarPreferences[] = [];
  const choices: RepositoryChoices = { ok: true, forge: githubForge, account: 'octo', origin: null, repositories: [{ forge: 'github', path: 'octo/unbound' }] };
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveSidebar: async (sidebar, preferences) => { if (sidebar === 'forgeSidebar') saved.push(preferences); snapshot[sidebar] = preferences; publish(); },
    activateProject: async id => { snapshot.activeProjectId = id; publish(); },
    saveLayout: async () => {},
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async () => choices,
  });
  render(<App />);
  return { user: userEvent.setup(), saved };
}

const sidebar = () => screen.queryByRole('complementary', { name: 'GitHub' });
const shownSidebar = () => waitFor(() => { const element = sidebar(); assert.ok(element, 'the sidebar is shown'); return element; });
const toggle = () => document.querySelector('.system-bar')!.lastElementChild as HTMLButtonElement;

test('the button at the right end of the system bar opens the sidebar for the current project, with focus inside, and closes it', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: 'Show the GitHub sidebar' });
  assert.equal(toggle().getAttribute('aria-label'), 'Show the GitHub sidebar', 'the toggle is the last item of the system bar');
  assert.equal(toggle().textContent, '', 'the toggle shows no count');
  assert.equal(sidebar(), null);
  await user.click(toggle());
  const opened = sidebar()!;
  assert.ok(within(opened).getByText('octo/bound'));
  assert.ok(opened.contains(document.activeElement), 'focus moves into the sidebar');
  assert.equal(toggle().getAttribute('aria-label'), 'Hide the GitHub sidebar');
  await user.click(toggle());
  assert.equal(sidebar(), null);
  assert.deepEqual(saved, [{ visible: true, width: 380 }, { visible: false, width: 380 }]);
});

test('Command+Alt+B opens the sidebar with focus inside wherever focus is, and closes it when open', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: 'Show the GitHub sidebar' });
  document.querySelector<HTMLElement>('.xterm-helper-textarea')!.focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.ok(sidebar()!.contains(document.activeElement));
  document.querySelector<HTMLElement>('.xterm-helper-textarea')!.focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.equal(sidebar(), null);
  await waitFor(() => assert.deepEqual(saved, [{ visible: true, width: 380 }, { visible: false, width: 380 }]));
});

test('the sidebar follows the current project and stays on the settings page', async () => {
  const { user } = renderWorkbench({ visible: true, width: 420 });
  assert.ok(within(await shownSidebar()).getByText('octo/bound'));
  assert.equal(sidebar()!.style.width, '420px');
  await user.click(screen.getByRole('button', { name: 'Unbound project' }));
  await waitFor(() => assert.ok(within(sidebar()!).getByText('No repository bound')));
  assert.equal(within(sidebar()!).queryByText('octo/bound'), null);
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  assert.ok(within(sidebar()!).getByText('No repository bound'));
});

test('an unbound project shows the empty state, and Bind repository opens Edit project with focus on the repository field', async () => {
  const { user } = renderWorkbench({ visible: true, width: 380 });
  await user.click(await screen.findByRole('button', { name: 'Unbound project' }));
  const opened = await shownSidebar();
  await waitFor(() => within(opened).getByText('This project has no GitHub repository bound.'));
  await user.click(within(opened).getByRole('button', { name: 'Bind repository' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit project' });
  const search = await within(dialog).findByRole('searchbox', { name: 'Search repositories' });
  await waitFor(() => assert.equal(document.activeElement, search));
  // The list the repository field loaded is drawn, so nothing is left to settle after the test.
  assert.ok(await within(dialog).findByText('octo/unbound'));
});
