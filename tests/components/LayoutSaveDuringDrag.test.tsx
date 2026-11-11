import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { Layout, PanelView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);
before(() => {
  // jsdom has no layout, frames, media queries or pointer capture. The layout area is 800×600, each panel slot
  // covers the share its inline position gives it and everything else (such as the tray) has no area, so
  // drops are hit tested against the displayed layout.
  // Only the layout area reports itself visible: panels report no layout, so terminals are not measured.
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });
  const area = new window.DOMRect(0, 0, 800, 600);
  Object.assign(window.HTMLElement.prototype, {
    checkVisibility: () => true,
    getClientRects(this: HTMLElement) { return this.classList.contains('canvas') ? [area] : []; },
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    getBoundingClientRect(this: HTMLElement) {
      if (this.classList.contains('canvas')) return area;
      const slot = this.closest<HTMLElement>('.canvas > .panel-slot');
      if (!slot) return new window.DOMRect(0, 0, 0, 0);
      const share = (value: string) => parseFloat(value) / 100;
      return new window.DOMRect(share(slot.style.left) * 800, share(slot.style.top) * 600, share(slot.style.width) * 800, share(slot.style.height) * 600);
    },
  });
});

const panel = (id: string, agent: PanelView['agent']): PanelView =>
  ({ id, agent, run: { id: `run-${id}`, panelId: id, projectId: 'project', state: 'running', title: `Session ${id}` }, status: 'ready' });
const sideBySide = (left: string, right: string): Layout => ({ axis: 'row', ratio: .5, first: { panel: left }, second: { panel: right } });

// Codex on the left and Claude Code on the right, with pi in the tray. A save never returns on its own: the test
// emits the saved snapshot.
async function renderWorkbench() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: false, width: 380 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Drops', directory: '/work/drops', layout: sideBySide('codex', 'claude'),
      panels: [panel('codex', 'codex'), panel('claude', 'claude')], tray: [panel('pi', 'pi')], dispatches: [] }],
  };
  const saves: Layout[] = [];
  // Placing a tray panel or moving a resident panel to the tray are the other changes a release can request.
  const otherChanges: string[] = [];
  let listener: (event: WorkbenchEvent) => void = () => {};
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: next => { listener = next; return () => {}; },
    activateProject: async () => {}, saveNavigation: async () => {},
    saveLayout: async (_project, layout) => { saves.push(layout!); },
    placeInLayout: async (_project, panelId) => { otherChanges.push(`place ${panelId}`); },
    moveToTray: async (_project, panelId) => { otherChanges.push(`move ${panelId}`); } });
  render(<App />);
  await screen.findAllByText('Session codex');
  const canvas = document.querySelector<HTMLElement>('.canvas')!;
  return {
    canvas, saves, otherChanges,
    // The main process saves a layout and reports the project as it now is.
    saved: (change: (project: Snapshot['projects'][number]) => void) => act(() => {
      change(snapshot.projects[0]);
      listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
    }),
  };
}

// Presses a resident panel's header, or a tray card, and moves to the given window point. A tray card reports no
// area here, so it is pressed at a point below the 800×600 layout area, where the tray lies.
function press(panelId: string, to: { x: number; y: number }) {
  const handle = document.querySelector<HTMLElement>(`.canvas > [data-panel-id="${panelId}"] .panel-header`)
    ?? document.querySelector<HTMLElement>(`[data-tray-panel-id="${panelId}"]`)!;
  const box = handle.getBoundingClientRect();
  const start = box.width ? { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 } : { clientX: 400, clientY: 650 };
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, ...start });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: to.x, clientY: to.y });
  return { release: () => fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y }) };
}
const left = { x: 200, y: 300 }, right = { x: 600, y: 300 };
const swapPreview = (label: string) => document.querySelector(`[role="img"][aria-label="${label}"]`);

test('a drag started before the previous drop is saved survives that save returning', async () => {
  const { canvas, saves, saved } = await renderWorkbench();
  press('codex', right).release();
  assert.deepEqual(saves, [sideBySide('claude', 'codex')]);

  // The drop is displayed at once; Claude Code is dragged back before the save returns.
  const drag = press('claude', right);
  assert.ok(canvas.classList.contains('dragging'));
  await saved(project => { project.layout = sideBySide('claude', 'codex'); });
  assert.ok(canvas.classList.contains('dragging'));
  assert.ok(swapPreview('Swap preview: Claude Code and Codex'));
  drag.release();
  assert.deepEqual(saves, [sideBySide('claude', 'codex'), sideBySide('codex', 'claude')]);
});

test('a snapshot that keeps the saved layout leaves a drag on an unsaved drop running', async () => {
  const { canvas, saved } = await renderWorkbench();
  press('codex', right).release();
  press('claude', right);
  // Another change, such as a run title, arrives while the drop is still being saved.
  await saved(project => { project.panels[0].run!.title = 'Renamed'; });
  assert.ok(canvas.classList.contains('dragging'));
  assert.ok(swapPreview('Swap preview: Claude Code and Codex'));
});

test('a drag is cancelled when the saved layout becomes a different one', async () => {
  const { canvas, saves, saved } = await renderWorkbench();
  const drag = press('codex', right);
  assert.ok(canvas.classList.contains('dragging'));
  const stacked: Layout = { axis: 'column', ratio: .5, first: { panel: 'codex' }, second: { panel: 'claude' } };
  await saved(project => { project.layout = stacked; });
  assert.ok(!canvas.classList.contains('dragging'));
  assert.equal(swapPreview('Swap preview: Codex and Claude Code'), null);
  drag.release();
  assert.deepEqual(saves, []);
  const codex = document.querySelector<HTMLElement>('[data-panel-id="codex"]')!;
  assert.deepEqual([codex.style.top, codex.style.height], ['0%', '50%']);
});

test('releasing a resident panel over its own slot changes nothing', async () => {
  const { canvas, saves, otherChanges } = await renderWorkbench();
  const drag = press('codex', { x: left.x + 20, y: left.y + 20 });
  assert.ok(canvas.classList.contains('dragging'));
  drag.release();
  assert.ok(!canvas.classList.contains('dragging'));
  assert.deepEqual(saves, []);
  assert.deepEqual(otherChanges, []);
});

test('releasing a tray card outside the layout area and the tray changes nothing', async () => {
  const { canvas, saves, otherChanges } = await renderWorkbench();
  const drag = press('pi', { x: 900, y: 300 });
  assert.ok(canvas.classList.contains('dragging'));
  drag.release();
  assert.ok(!canvas.classList.contains('dragging'));
  assert.deepEqual(saves, []);
  assert.deepEqual(otherChanges, []);
});

test('Esc cancels a drag over a valid drop, and the later release changes nothing', async () => {
  const { canvas, saves, otherChanges } = await renderWorkbench();
  for (const [panelId, label] of [['codex', 'Swap preview: Codex and Claude Code'], ['pi', 'Swap preview: pi and Claude Code']]) {
    const drag = press(panelId, right);
    assert.ok(swapPreview(label), label);
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.ok(!canvas.classList.contains('dragging'));
    assert.equal(swapPreview(label), null);
    drag.release();
  }
  assert.deepEqual(saves, []);
  assert.deepEqual(otherChanges, []);
});
