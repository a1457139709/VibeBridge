import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
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
    checkVisibility: () => true,
    getBoundingClientRect: () => area,
    getClientRects: () => [area],
    setPointerCapture() {},
    releasePointerCapture() {},
    hasPointerCapture: () => false,
  });
});

function renderWorkbench(resident = false) {
  const placed = deferred<void>();
  const requests: [string, string, Layout][] = [];
  const moved: [string, string][] = [];
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: false, width: 380 },
    activeProjectId: 'project',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [
      {
        id: 'project',
        name: 'Placement',
        directory: '/work/placement',
        layout: resident ? { panel: 'resident' } : null,
        panels: resident
          ? [
              {
                id: 'resident',
                agent: 'claude',
                run: {
                  id: 'run-resident',
                  panelId: 'resident',
                  projectId: 'project',
                  state: 'starting',
                  title: 'Session resident',
                },
              },
            ]
          : [],
        tray: [
          {
            id: 'ephemeral',
            agent: 'codex',
            run: {
              id: 'run-ephemeral',
              panelId: 'ephemeral',
              projectId: 'project',
              state: 'starting',
              title: 'Session ephemeral',
            },
          },
        ],
        repository: null,
        ...githubView,
      },
    ],
  };
  provideWorkbench({
    snapshot: async () => structuredClone(snapshot),
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ready: async () => {},
    activateProject: async () => {},
    saveSidebar: async () => {},
    saveLayout: async () => {},
    placeInLayout: (...request) => {
      requests.push(request);
      return placed.promise;
    },
    moveToTray: async (...request) => {
      // The main process moves the panel from the layout to the tray's end; `publish` delivers that snapshot.
      moved.push(request);
      const [project] = snapshot.projects;
      const panel = project.panels.find(item => item.id === request[1])!;
      Object.assign(project, {
        layout: null,
        panels: project.panels.filter(item => item !== panel),
        tray: [...project.tray, panel],
      });
    },
  });
  render(<App />);
  const publish = () =>
    act(async () => {
      for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) });
    });
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
  await act(async () => {
    placed.reject(new Error('The layout does not match.'));
    await placed.promise.catch(() => {});
  });
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
});

test("a resident panel's move-to-tray action moves it to the tray without opening it", async () => {
  const { user, moved } = renderWorkbench(true);
  await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const header = document.querySelector<HTMLElement>('.canvas [data-panel-id="resident"] .panel-actions')!;
  const actions = within(header).getAllByRole('button');
  assert.deepEqual(
    actions.map(action => action.getAttribute('aria-label')),
    ['Move to tray', 'Maximize panel', 'Close panel'],
  );
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
  assert.deepEqual(
    within(tray)
      .getAllByRole('button')
      .map(card => card.getAttribute('aria-pressed')),
    ['false', 'false'],
  );
  assert.equal(screen.queryByRole('button', { name: 'Collapse panel' }), null);
});

/** Records the animations the workbench starts; each finishes when the test says so. */
function recordAnimations(reducedMotion: boolean) {
  const started: { target: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish(): void }[] = [];
  const slot = new window.DOMRect(0, 0, 800, 600),
    card = new window.DOMRect(8, 566, 200, 30);
  Object.assign(window.HTMLElement.prototype, {
    getBoundingClientRect(this: HTMLElement) {
      return this.matches('.tray-card') ? card : slot;
    },
    animate(this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const finished = deferred<void>();
      started.push({ target: this, keyframes, options, finish: () => finished.resolve() });
      return { finished: finished.promise, cancel() {} };
    },
  });
  const matchMedia = (query: string) => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
    addEventListener() {},
    removeEventListener() {},
  });
  Object.assign(globalThis, { matchMedia });
  Object.assign(window, { matchMedia });
  return started;
}
afterEach(() => {
  delete (window.HTMLElement.prototype as Partial<HTMLElement>).animate;
  const area = new window.DOMRect(0, 0, 800, 600);
  Object.assign(window.HTMLElement.prototype, { getBoundingClientRect: () => area });
  stubLayoutApis();
});

const toCard = { transform: 'translate(8px, 566px) scale(0.25, 0.05)', opacity: 0.35, transformOrigin: '0 0' },
  inPlace = { transform: 'none', opacity: 1, transformOrigin: '0 0' };

test('an open tray panel grows from its card, and collapsing it flies it back into the card, which then flashes', async () => {
  const started = recordAnimations(false);
  const { user } = renderWorkbench();
  const tray = await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const card = within(tray).getByRole('button', { name: /Session ephemeral/ });
  const slot = () => document.querySelector('.canvas [data-panel-id="ephemeral"]');
  await user.click(card);
  assert.deepEqual(
    started.map(({ target, keyframes, options }) => [target.getAttribute('data-panel-id'), keyframes, options]),
    [['ephemeral', [toCard, inPlace], { duration: 260, easing: 'cubic-bezier(.2,0,.2,1)' }]],
  );

  await user.click(screen.getByRole('button', { name: 'Collapse panel' }));
  assert.equal(started.length, 2);
  assert.deepEqual(
    [started[1].target.getAttribute('data-panel-id'), started[1].keyframes, started[1].options],
    ['ephemeral', [inPlace, toCard], { duration: 260, easing: 'cubic-bezier(.4,0,.7,1)', fill: 'forwards' }],
  );
  assert.equal(card.getAttribute('aria-pressed'), 'true', 'the panel stays open while it flies');
  await act(async () => started[1].finish());
  await waitFor(() => assert.equal(card.getAttribute('aria-pressed'), 'false'));
  assert.equal(slot(), null);
  assert.ok(card.classList.contains('landed'), 'the card flashes once the panel lands');
  fireEvent.animationEnd(card);
  assert.ok(!card.classList.contains('landed'));
});

test('with reduced motion the tray panel opens and collapses at once, and its card does not flash', async () => {
  const started = recordAnimations(true);
  const { user } = renderWorkbench();
  const tray = await screen.findByRole('region', { name: 'Ephemeral panel tray' });
  const card = within(tray).getByRole('button', { name: /Session ephemeral/ });
  await user.click(card);
  assert.ok(screen.getByRole('button', { name: 'Collapse panel' }));
  await user.click(screen.getByRole('button', { name: 'Collapse panel' }));
  assert.equal(card.getAttribute('aria-pressed'), 'false');
  assert.equal(screen.queryByRole('button', { name: 'Collapse panel' }), null);
  assert.ok(!card.classList.contains('landed'));
  assert.equal(started.length, 0, 'nothing animates');
});
