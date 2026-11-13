import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { Layout, Snapshot } from '../../app/shared/model';
import type { WorkbenchEvent } from '../../app/shared/model';
import { deferred, provideWorkbench } from './support/workbench';
import { githubView } from './support/forge';
import { stubLayoutApis } from './support/no-layout';


afterEach(cleanup);
before(() => {
  // jsdom has no layout, frames, media queries or pointer capture. Every element reports one fixed area,
  // so these tests cover what a drop does, not where the pointer has to be.
  stubLayoutApis();
  Object.assign(globalThis, { getComputedStyle: window.getComputedStyle.bind(window) });
  const area = new window.DOMRect(0, 0, 800, 600);
  Object.assign(window.HTMLElement.prototype, {
    checkVisibility: () => true, getBoundingClientRect: () => area, getClientRects: () => [area],
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  });
});

function renderWorkbench(resident = false) {
  const placed = deferred<void>();
  const requests: [string, string, Layout][] = [];
  const moved: [string, string][] = [];
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, forgeSidebar: { visible: false, width: 380 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Placement', directory: '/work/placement',
      layout: resident ? { panel: 'resident' } : null,
      panels: resident ? [{ id: 'resident', agent: 'claude', run: { id: 'run-resident', panelId: 'resident', projectId: 'project', state: 'starting', title: 'Session resident' } }] : [],
      tray: [{ id: 'ephemeral', agent: 'codex', run: { id: 'run-ephemeral', panelId: 'ephemeral', projectId: 'project', state: 'starting', title: 'Session ephemeral' } }], repository: null, ...githubView }],
  };
  provideWorkbench({ snapshot: async () => structuredClone(snapshot),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, ready: async () => {},
    activateProject: async () => {}, saveSidebar: async () => {}, saveLayout: async () => {},
    placeInLayout: (...request) => { requests.push(request); return placed.promise; },
    moveToTray: async (...request) => {
      // The main process moves the panel from the layout to the tray's end; `publish` delivers that snapshot.
      moved.push(request);
      const [project] = snapshot.projects;
      const panel = project.panels.find(item => item.id === request[1])!;
      Object.assign(project, { layout: null, panels: project.panels.filter(item => item !== panel), tray: [...project.tray, panel] });
    } });
  render(<App />);
  const publish = () => act(async () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) }); });
  return { user: userEvent.setup(), placed, requests, moved, publish };
}

function drag(handle: HTMLElement) {
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300, clientY: 300 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 300, clientY: 300 });
}

test('a rejected placement leaves the open tray panel open', async () => {
  const { user, placed, requests } = renderWorkbench();
  const tray = await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const card = within(tray).getByRole('button', { name: /Session ephemeral/ });
  await user.click(card);
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));

  drag(card);
  assert.deepEqual(requests, [['project', 'ephemeral', { panel: 'ephemeral' }]]);
  await act(async () => { placed.reject(new Error('The layout does not match.')); await placed.promise.catch(() => {}); });
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
});

test('a resident panel\'s move-to-tray action moves it to the tray without opening it', async () => {
  const { user, moved } = renderWorkbench(true);
  await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const header = document.querySelector<HTMLElement>('.canvas [data-panel-id="resident"] .panel-actions')!;
  const actions = within(header).getAllByRole('button');
  assert.deepEqual(actions.map(action => action.getAttribute('aria-label')), ['Move to tray', 'Maximize panel', 'Close panel']);
  await user.click(actions[0]);
  assert.deepEqual(moved, [['project', 'resident']]);
  assert.equal(screen.queryByRole('button', { name: 'Collapse panel' }), null);
});

test('moving the maximized resident panel to the tray leaves it collapsed in the tray', async () => {
  const { user, moved, publish } = renderWorkbench(true);
  await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const actions = () => document.querySelector<HTMLElement>('.canvas [data-panel-id="resident"] .panel-actions')!;
  await user.click(within(actions()).getByRole('button', { name: 'Maximize panel' }));
  await user.click(within(actions()).getByRole('button', { name: 'Move to tray' }));
  assert.deepEqual(moved, [['project', 'resident']]);
  await publish();
  const tray = screen.getByRole('region', { name: 'Ephemeral panel tray' });
  assert.deepEqual(within(tray).getAllByRole('button').map(card => card.getAttribute('aria-pressed')), ['false', 'false']);
  assert.equal(screen.queryByRole('button', { name: 'Collapse panel' }), null);
});
