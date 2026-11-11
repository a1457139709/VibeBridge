import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { PanelView, ProjectView, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  // jsdom has no layout, frames or media queries. The shell and its terminals only need these to exist;
  // frames never run, so these tests cannot verify focus or animation.
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const panel = (id: string, status: ProcessingState): PanelView =>
  ({ id, agent: 'codex', run: { id: `run-${id}`, panelId: id, projectId: 'project', state: 'running', title: `Session ${id}` }, status });

const project = (): ProjectView => ({
  id: 'project', name: 'Toolbar project', directory: '/work/toolbar-directory',
  layout: { panel: 'resident' }, panels: [panel('resident', 'done')],
  tray: [panel('first-ephemeral', 'needs-input'), panel('second-ephemeral', 'done')], dispatches: [],
});

function renderWorkbench(change: (snapshot: Snapshot) => void = () => {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: false, width: 380 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [], projects: [project()],
  };
  change(snapshot);
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, ready: async () => {},
    activateProject: async () => {}, saveNavigation: async () => {}, saveLayout: async () => {} });
  render(<App />);
  return userEvent.setup();
}

test('the workspace toolbar holds the project summary of resident and tray panels and shows no project name, directory or panel count', async () => {
  renderWorkbench();
  const toolbar = (await screen.findByRole('button', { name: 'Add Agent' })).closest('header')!;
  const summary = within(toolbar).getByRole('region', { name: 'Current project summary' });
  assert.deepEqual(within(summary).getAllByRole('button').map(button => button.getAttribute('aria-label')), ['0 Ready', '1 Needs input', '2 Done', '0 Error']);
  assert.equal(toolbar.textContent?.includes('Toolbar project'), false);
  assert.equal(toolbar.textContent?.includes('toolbar-directory'), false);
  assert.equal(toolbar.textContent?.includes('panel'), false);
  assert.equal(document.querySelector('.system-bar')?.textContent, '☷VibeBridge');
});

test('choosing a tray panel in the summary opens it ephemerally', async () => {
  const user = renderWorkbench();
  await user.click(await screen.findByRole('button', { name: '2 Done' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Done' })).getByRole('button', { name: /Session second-ephemeral/ }));
  assert.ok(!screen.queryByRole('dialog'));
  const card = within(screen.getByRole('region', { name: 'Ephemeral panel tray' })).getByRole('button', { name: /Session second-ephemeral/ });
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
  await user.click(screen.getByRole('button', { name: '1 Needs input' }));
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog'));
  assert.equal(card.getAttribute('aria-pressed'), 'true', 'Escape closes only the summary list');
});

test('Escape in an open tray panel\'s terminal goes to the terminal and leaves the panel open', async () => {
  const user = renderWorkbench();
  const tray = await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  await user.click(within(tray).getByRole('button', { name: /Session first-ephemeral/ }));
  document.querySelector<HTMLElement>('.canvas > [data-panel-id="first-ephemeral"] .xterm-helper-textarea')!.focus();
  await user.keyboard('{Escape}');
  assert.deepEqual(within(tray).getAllByRole('button').map(card => card.getAttribute('aria-pressed')), ['true', 'false']);
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
});

test('choosing a resident panel in the summary leaves the tray closed', async () => {
  const user = renderWorkbench();
  await user.click(await screen.findByRole('button', { name: '2 Done' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Done' })).getByRole('button', { name: /Session resident/ }));
  const cards = within(screen.getByRole('region', { name: 'Ephemeral panel tray' })).getAllByRole('button');
  assert.deepEqual(cards.map(card => card.getAttribute('aria-pressed')), ['false', 'false']);
  assert.ok(!screen.queryByRole('button', { name: 'Collapse panel' }));
});

test('choosing a resident panel in the summary while a tray panel is open collapses back to the layout', async () => {
  const user = renderWorkbench();
  const tray = await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  await user.click(within(tray).getByRole('button', { name: /Session first-ephemeral/ }));
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
  await user.click(screen.getByRole('button', { name: '2 Done' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Done' })).getByRole('button', { name: /Session resident/ }));
  assert.deepEqual(within(tray).getAllByRole('button').map(card => card.getAttribute('aria-pressed')), ['false', 'false']);
  assert.ok(!screen.queryByRole('button', { name: 'Collapse panel' }));
  assert.ok(screen.getByRole('button', { name: 'Maximize panel' }), 'the resident panel is not maximized in place of the tray panel');
});

test('the summary is not shown on the settings page, the project creation guide or the welcome page', async () => {
  const user = renderWorkbench();
  await screen.findByRole('region', { name: 'Current project summary' });
  await user.click(screen.getByRole('button', { name: 'Global settings' }));
  await screen.findByRole('button', { name: '‹ Back' });
  assert.ok(!screen.queryByRole('region', { name: 'Current project summary' }));
  cleanup();

  renderWorkbench(snapshot => { snapshot.activeProjectId = null; });
  await screen.findByRole('button', { name: 'Create project' });
  assert.ok(!screen.queryByRole('region', { name: 'Current project summary' }));
  cleanup();

  renderWorkbench(snapshot => { snapshot.projects = []; snapshot.activeProjectId = null; });
  await screen.findByRole('textbox', { name: 'Project name' });
  assert.ok(!screen.queryByRole('region', { name: 'Current project summary' }));
});
