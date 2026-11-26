import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before, beforeEach } from 'node:test';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { PanelView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';
import { testForgeView } from './support/forge';
import { t } from './support/localization';
import { requireValue } from '../../app/renderer/common/required';
import { selectElement } from './support/elements';
import { nameIncluding, summaryEntryName } from './support/accessible-names';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const unavailable = new Set<string>();

afterEach(cleanup);
beforeEach(() => {
  frames.clear();
  unavailable.clear();
});
before(() => {
  for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
  const matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  const requestAnimationFrame = (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  const cancelAnimationFrame = (id: number) => {
    frames.delete(id);
  };
  for (const target of [globalThis, window])
    Object.assign(target, { matchMedia, requestAnimationFrame, cancelAnimationFrame });
  const available = (element: HTMLElement) =>
    !unavailable.has(element.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId ?? '');
  Object.assign(window.HTMLElement.prototype, {
    checkVisibility(this: HTMLElement) {
      return available(this);
    },
  });
  for (const size of ['clientWidth', 'clientHeight']) {
    Object.defineProperty(window.HTMLElement.prototype, size, {
      configurable: true,
      get(this: HTMLElement) {
        return available(this) ? 100 : 0;
      },
    });
  }
});

const runFrame = () =>
  act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
const settle = async () => {
  for (let round = 0; frames.size; round++) {
    assert.ok(round < 50, 'frames keep requesting frames');
    await runFrame();
  }
};

const title = (id: string) => `Session ${id}`;

const panel = (id: string): PanelView => ({
  id,
  agent: 'codex',
  run: { id: `run-${id}`, panelId: id, projectId: 'project', state: 'running', title: title(id) },
  status: 'done',
});

async function renderWorkbench() {
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
        name: 'Locating',
        directory: '/work/locating',
        layout: { axis: 'row', ratio: 0.5, first: { panel: 'first' }, second: { panel: 'second' } },
        panels: [panel('first'), panel('second')],
        tray: [],
        repository: null,
        ...testForgeView,
      },
    ],
  };
  let listener: (event: WorkbenchEvent) => void = () => {};
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: next => {
      listener = next;
      return () => {};
    },
    activateProject: async () => {},
    saveSidebar: async () => {},
    saveLayout: async () => {},
  });
  render(<App />);
  await screen.findByRole('button', { name: summaryEntryName(snapshot.projects[0].panels.length, 'done') });
  const user = userEvent.setup();
  return {
    user,
    focused: () =>
      document.activeElement?.classList.contains('xterm-helper-textarea')
        ? document.activeElement.closest<HTMLElement>('[data-panel-id]')?.dataset.panelId
        : undefined,
    locating: () => selectElement('.workbench-page').classList.contains('locating-panel'),
    open: () =>
      user.click(screen.getByRole('button', { name: summaryEntryName(snapshot.projects[0].panels.length, 'done') })),
    async choose(panelId: string) {
      await this.open();
      await user.click(
        within(screen.getByRole('dialog', { name: t('done') })).getByRole('button', {
          name: nameIncluding(title(panelId)),
        }),
      );
      await runFrame();
    },
    close: (panelId: string) =>
      act(() => {
        const [project] = snapshot.projects;
        Object.assign(project, {
          layout: {
            panel: requireValue(
              project.panels.find(item => item.id !== panelId),
              'another panel',
            ).id,
          },
          panels: project.panels.filter(item => item.id !== panelId),
        });
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
  const list = screen.getByRole('dialog', { name: t('done') });
  assert.ok(list.contains(document.activeElement));
  await f.close('second');
  await settle();
  assert.ok(list.contains(document.activeElement), 'the closed panel cannot move focus to a terminal');
});

test("clicking a panel's header gives its terminal keyboard focus at once", async () => {
  const f = await renderWorkbench();
  await settle();
  assert.equal(f.focused(), 'first');
  await f.user.click(selectElement('[data-panel-id="second"] .panel-header'));
  assert.equal(f.focused(), 'second');
});

test('enlarging a panel gives its terminal keyboard focus at once, and restoring keeps it there', async () => {
  const f = await renderWorkbench();
  await settle();
  const second = selectElement('[data-panel-id="second"]');
  await f.user.click(within(second).getByRole('button', { name: t('enlargePanel') }));
  assert.equal(f.focused(), 'second');
  await f.user.click(within(second).getByRole('button', { name: t('restorePanel') }));
  await settle();
  assert.equal(f.focused(), 'second');
});

test('returning from the settings page gives the selected terminal keyboard focus again', async () => {
  const f = await renderWorkbench();
  await settle();
  await f.user.click(selectElement('[data-panel-id="second"] .panel-header'));
  await f.user.click(screen.getByRole('button', { name: t('settings') }));
  await settle();
  assert.equal(f.focused(), undefined);
  await f.user.click(screen.getByRole('button', { name: t('back') }));
  await settle();
  assert.equal(f.focused(), 'second');
});
