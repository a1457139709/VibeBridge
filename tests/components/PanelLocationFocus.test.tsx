import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before, beforeEach } from 'node:test';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings';
import type { PanelView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';
import { githubForge } from './support/forge';

// Frames run only when the test runs them, so every frame a pending location could use has run before an assertion.
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
// Terminals of these panels are on screen but cannot take input yet, as during a delayed layout.
const unavailable = new Set<string>();

afterEach(cleanup);
beforeEach(() => { frames.clear(); unavailable.clear(); });
before(() => {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
  }
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; };
  const cancelAnimationFrame = (id: number) => { frames.delete(id); };
  for (const target of [globalThis, window]) Object.assign(target, { matchMedia, requestAnimationFrame, cancelAnimationFrame });
  const available = (element: HTMLElement) => !unavailable.has(element.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? '');
  Object.assign(window.HTMLElement.prototype, { checkVisibility(this: HTMLElement) { return available(this); } });
  for (const size of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(window.HTMLElement.prototype, size, { configurable: true, get(this: HTMLElement) { return available(this) ? 100 : 0; } });
  }
});

/** Runs the frames requested so far; frames they request wait for the next call. */
const runFrame = () => act(async () => {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(0);
});
/** Runs frames until none is requested, so no pending work can change focus afterwards. A location
 * waiting for its terminal requests a frame every frame, so this also proves no location still waits. */
const settle = async () => {
  for (let round = 0; frames.size; round++) {
    assert.ok(round < 50, 'frames keep requesting frames');
    await runFrame();
  }
};

const panel = (id: string): PanelView =>
  ({ id, agent: 'codex', run: { id: `run-${id}`, panelId: id, projectId: 'project', state: 'running', title: `Session ${id}` }, status: 'done' });

async function renderWorkbench() {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, issueSidebar: { visible: false, width: 380 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Locating', directory: '/work/locating',
      layout: { axis: 'row', ratio: .5, first: { panel: 'first' }, second: { panel: 'second' } },
      panels: [panel('first'), panel('second')], tray: [], repository: null, forge: githubForge }],
  };
  let listener: (event: WorkbenchEvent) => void = () => {};
  provideWorkbench({ snapshot: async () => structuredClone(snapshot), ready: async () => {},
    subscribe: next => { listener = next; return () => {}; },
    activateProject: async () => {}, saveNavigation: async () => {}, saveLayout: async () => {} });
  render(<App />);
  await screen.findAllByText('Session first');
  const user = userEvent.setup();
  return {
    // The panel whose terminal receives keyboard input, if any.
    focused: () => document.activeElement?.classList.contains('xterm-helper-textarea')
      ? document.activeElement.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId : undefined,
    locating: () => document.querySelector('.workbench-page')!.classList.contains('locating-panel'),
    open: () => user.click(screen.getByRole('button', { name: /^\d+ Done$/ })),
    async choose(panelId: string) {
      await this.open();
      await user.click(within(screen.getByRole('dialog', { name: 'Done' })).getByRole('button', { name: new RegExp(`Session ${panelId}`) }));
      await runFrame();
    },
    // The main process closes a panel and reports the project as it now is.
    close: (panelId: string) => act(() => {
      const [project] = snapshot.projects;
      Object.assign(project, { layout: { panel: project.panels.find(item => item.id !== panelId)!.id }, panels: project.panels.filter(item => item.id !== panelId) });
      listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
    }),
  };
}

test('a newer selection supersedes a location still waiting for its terminal, which never takes focus later', async () => {
  const f = await renderWorkbench();
  unavailable.add('first');
  await f.choose('first');
  assert.ok(f.locating(), 'locating waits for the first terminal');
  await f.choose('second');
  assert.equal(f.focused(), 'second');
  unavailable.delete('first');
  await settle();
  assert.equal(f.focused(), 'second');
  assert.ok(!f.locating());
});

test('a location whose panel closes while it waits ends without focusing the remaining panel', async () => {
  const f = await renderWorkbench();
  unavailable.add('first');
  await f.choose('first');
  assert.ok(f.locating(), 'locating waits for the first terminal');
  await f.close('first');
  await settle();
  assert.ok(!f.locating());
  assert.equal(f.focused(), undefined);
});

test('a panel closing while a summary list is open leaves keyboard focus in the list', async () => {
  const f = await renderWorkbench();
  await settle();
  assert.equal(f.focused(), 'first');
  await f.open();
  const list = screen.getByRole('dialog', { name: 'Done' });
  assert.ok(list.contains(document.activeElement));
  await f.close('second');
  await settle();
  assert.ok(list.contains(document.activeElement), 'the closed panel cannot move focus to a terminal');
});
