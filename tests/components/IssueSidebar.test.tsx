import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { IssueSidebarPreferences, ProjectView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { RepositoryChoices } from '../../app/shared/code-hosting';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  // Switching projects unmounts a workspace, which checks for a running locate animation.
  Object.assign(globalThis, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
});

const unbound: ProjectView = { id: 'unbound', name: 'Unbound project', directory: '/work/unbound', layout: null, panels: [], tray: [] };
const bound: ProjectView = { id: 'bound', name: 'Bound project', directory: '/work/bound', layout: null, panels: [], tray: [],
  repository: { platform: 'github', path: 'octo/app' } };

function renderWorkbench({ issueSidebar = { visible: false, width: 380 }, activeProjectId = unbound.id, choices = async () => new Promise<RepositoryChoices>(() => {}) }: {
  issueSidebar?: IssueSidebarPreferences; activeProjectId?: string; choices?: () => Promise<RepositoryChoices>;
} = {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar, activeProjectId, settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [unbound, bound],
  };
  const saved: IssueSidebarPreferences[] = [];
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    ready: async () => {}, activateProject: async id => {
      snapshot.activeProjectId = id;
      for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
    }, saveNavigation: async () => {}, saveLayout: async () => {},
    saveIssueSidebar: async preferences => { saved.push(preferences); },
    inspectDirectory: async directory => ({ valid: true, directory }), repositoryChoices: choices });
  render(<App />);
  return { user: userEvent.setup(), saved };
}
const sidebar = () => screen.queryByRole('complementary', { name: /Issues|GitHub/ });

test('the toggle at the right end of the system bar opens and closes the issue sidebar and saves its state', async () => {
  const { user, saved } = renderWorkbench();
  const open = await screen.findByRole('button', { name: 'Open issue sidebar' });
  const bar = document.querySelector<HTMLElement>('.system-bar')!;
  assert.ok(bar.lastElementChild === open, 'the issue sidebar toggle sits at the right end');
  assert.equal(within(bar).getAllByRole('button')[0].getAttribute('aria-label'), 'Collapse project navigation');
  assert.equal(open.textContent, '', 'the toggle shows no count');
  assert.equal(sidebar(), null);
  await user.click(open);
  assert.ok(sidebar());
  assert.equal(open.getAttribute('aria-label'), 'Close issue sidebar');
  assert.equal(open.getAttribute('aria-expanded'), 'true');
  await user.click(open);
  assert.equal(sidebar(), null);
  assert.deepEqual(saved, [{ visible: true, width: 380 }, { visible: false, width: 380 }]);
});

test('the toggle shortcut opens the sidebar with focus inside it and closes it wherever focus is', async () => {
  const { user, saved } = renderWorkbench();
  await screen.findByRole('button', { name: 'Open issue sidebar' });
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  const opened = sidebar()!;
  assert.ok(opened.contains(document.activeElement), 'focus moves into the sidebar');
  screen.getByRole('button', { name: 'Collapse project navigation' }).focus();
  await user.keyboard('{Meta>}{Alt>}b{/Alt}{/Meta}');
  assert.equal(sidebar(), null);
  assert.deepEqual(saved.map(state => state.visible), [true, false]);
});

test('the sidebar is titled by the bound platform and follows the active project', async () => {
  const { user } = renderWorkbench({ issueSidebar: { visible: true, width: 420 }, activeProjectId: bound.id });
  const shown = await screen.findByRole('complementary', { name: 'GitHub' });
  assert.ok(within(shown).getByText('octo/app'));
  assert.equal(within(shown).queryByRole('button', { name: 'Bind repository' }), null);
  await user.click(screen.getByRole('button', { name: 'Unbound project' }));
  const unboundSidebar = await screen.findByRole('complementary', { name: 'Issues' });
  assert.ok(within(unboundSidebar).getByRole('button', { name: 'Bind repository' }));
  assert.equal(within(unboundSidebar).queryByText('octo/app'), null);
});

test('the sidebar stays open on the settings page', async () => {
  const { user } = renderWorkbench({ issueSidebar: { visible: true, width: 420 } });
  await screen.findByRole('complementary', { name: 'Issues' });
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('heading', { name: 'General settings' });
  assert.ok(screen.getByRole('complementary', { name: 'Issues' }));
});

test('binding a repository from the empty state opens the project editor with focus on the repository field', async () => {
  const choices = deferred<RepositoryChoices>();
  const { user } = renderWorkbench({ issueSidebar: { visible: true, width: 420 }, choices: () => choices.promise });
  await user.click(await screen.findByRole('button', { name: 'Bind repository' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit project' });
  assert.equal((within(dialog).getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value, 'Unbound project');
  assert.equal(document.activeElement, within(dialog).getByRole('status', { name: 'Repository' }));
  choices.resolve({ ok: true, platform: { id: 'github', name: 'GitHub', installUrl: '', signInCommand: '', capabilities: [] }, account: 'octo',
    repositories: [{ platform: 'github', path: 'octo/app' }], suggested: null });
  const field = await within(dialog).findByRole('combobox', { name: 'Repository' });
  assert.equal(document.activeElement, field);
  fireEvent.keyDown(dialog, { key: 'Escape' });
});

test('dragging the left edge resizes the sidebar between 300 and 560 px and saves the width', async () => {
  const { saved } = renderWorkbench({ issueSidebar: { visible: true, width: 400 } });
  const edge = await screen.findByRole('separator', { name: 'Resize issue sidebar' });
  edge.parentElement!.getBoundingClientRect = () => ({ width: 400 } as DOMRect);
  Object.assign(edge, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => true });
  fireEvent.pointerDown(edge, { button: 0, clientX: 1000, pointerId: 1 });
  fireEvent.pointerMove(edge, { clientX: 900, pointerId: 1 });
  assert.equal(sidebar()!.style.getPropertyValue('--issue-sidebar-width'), '500px');
  fireEvent.pointerMove(edge, { clientX: 700, pointerId: 1 });
  fireEvent.pointerUp(edge, { clientX: 700, pointerId: 1 });
  assert.deepEqual(saved, [{ visible: true, width: 560 }]);
});
