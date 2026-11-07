import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Workbench } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { Layout, Snapshot } from '../../app/shared/model';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  // jsdom has no layout, frames, media queries or pointer capture. Every element reports one fixed area,
  // so these tests cover what a drop does, not where the pointer has to be.
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  const area = new window.DOMRect(0, 0, 800, 600);
  Object.assign(window.HTMLElement.prototype, {
    checkVisibility: () => true, getBoundingClientRect: () => area, getClientRects: () => [area],
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
  });
});

function renderWorkbench() {
  const placed = deferred<void>();
  const requests: [string, string, Layout][] = [];
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Placement', directory: '/work/placement', layout: null, panels: [],
      tray: [{ id: 'ephemeral', agent: 'codex', run: { id: 'run-ephemeral', panelId: 'ephemeral', projectId: 'project', state: 'starting', title: 'Session ephemeral' } }] }],
  };
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), subscribe: () => () => {}, ready: async () => {},
    activateProject: async () => {}, saveNavigation: async () => {}, saveLayout: async () => {},
    placeInLayout: (...request) => { requests.push(request); return placed.promise; } });
  render(<Workbench />);
  return { user: userEvent.setup(), placed, requests };
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
