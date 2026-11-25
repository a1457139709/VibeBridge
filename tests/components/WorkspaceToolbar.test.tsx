import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { PanelView, ProjectView, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import { stubLayoutApis } from './support/no-layout';
import { provideWorkbench } from './support/workbench';
import { testForgeView } from './support/forge';
import { t } from './support/localization';
import { requireValue } from '../../app/renderer/common/required';
import { selectElement } from './support/elements';
import { nameIncluding, summaryEntryName } from './support/accessible-names';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const title = (id: string) => `Session ${id}`;
const titled = (id: string) => nameIncluding(title(id));

const panel = (id: string, status: ProcessingState): PanelView => ({
  id,
  agent: 'codex',
  run: { id: `run-${id}`, panelId: id, projectId: 'project', state: 'running', title: title(id) },
  status,
});

const project = (): ProjectView => ({
  id: 'project',
  name: 'Toolbar project',
  directory: '/work/toolbar-directory',
  layout: { panel: 'resident' },
  panels: [panel('resident', 'done')],
  tray: [panel('first-ephemeral', 'needs-input'), panel('second-ephemeral', 'done')],
  repository: null,
  ...testForgeView,
});

function renderWorkbench(change: (snapshot: Snapshot) => void = () => {}) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: false, width: 380 },
    activeProjectId: 'project',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [project()],
  };
  change(snapshot);
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    subscribe: () => () => {},
    reportRendererReady: async () => {},
    activateProject: async () => {},
    saveSidebar: async () => {},
    saveLayout: async () => {},
  });
  render(<App />);
  return userEvent.setup();
}

test('the workspace toolbar holds the project summary of resident and tray panels and shows no project name, directory or panel count', async () => {
  renderWorkbench();
  const toolbar = requireValue(
    (await screen.findByRole('button', { name: t('addPanel') })).closest('header'),
    'the toolbar',
  );
  const summary = within(toolbar).getByRole('region', { name: t('projectSummary') });
  assert.deepEqual(
    within(summary)
      .getAllByRole('button')
      .map(button => button.getAttribute('aria-label')),
    [
      summaryEntryName(0, 'ready'),
      summaryEntryName(1, 'needs-input'),
      summaryEntryName(2, 'done'),
      summaryEntryName(0, 'error'),
    ],
  );
  for (const bar of [toolbar, selectElement('.system-bar')])
    for (const shown of ['Toolbar project', 'toolbar-directory', t('panelCount', { count: 3 })])
      assert.equal(bar.textContent?.includes(shown), false, shown);
});

test('choosing a tray panel in the summary opens it ephemerally', async () => {
  const user = renderWorkbench();
  await user.click(await screen.findByRole('button', { name: summaryEntryName(2, 'done') }));
  await user.click(
    within(screen.getByRole('dialog', { name: t('done') })).getByRole('button', { name: titled('second-ephemeral') }),
  );
  assert.ok(!screen.queryByRole('dialog'));
  const card = within(screen.getByRole('region', { name: t('panelTray') })).getByRole('button', {
    name: titled('second-ephemeral'),
  });
  assert.equal(card.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.getByRole('button', { name: t('collapsePanel') }));
  await user.click(screen.getByRole('button', { name: summaryEntryName(1, 'needs-input') }));
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog'));
  assert.equal(card.getAttribute('aria-pressed'), 'true', 'Escape closes only the summary list');
});

test("Escape in an open tray panel's terminal goes to the terminal and leaves the panel open", async () => {
  const user = renderWorkbench();
  const tray = await screen.findByRole('region', { name: t('panelTray') });
  await user.click(within(tray).getByRole('button', { name: titled('first-ephemeral') }));
  selectElement('.canvas > [data-panel-id="first-ephemeral"] .xterm-helper-textarea').focus();
  await user.keyboard('{Escape}');
  assert.deepEqual(
    within(tray)
      .getAllByRole('button')
      .map(card => card.getAttribute('aria-pressed')),
    ['true', 'false'],
  );
  assert.ok(screen.getByRole('button', { name: t('collapsePanel') }));
});

test('choosing a resident panel in the summary leaves the tray closed', async () => {
  const user = renderWorkbench();
  await user.click(await screen.findByRole('button', { name: summaryEntryName(2, 'done') }));
  await user.click(
    within(screen.getByRole('dialog', { name: t('done') })).getByRole('button', { name: titled('resident') }),
  );
  const cards = within(screen.getByRole('region', { name: t('panelTray') })).getAllByRole('button');
  assert.deepEqual(
    cards.map(card => card.getAttribute('aria-pressed')),
    ['false', 'false'],
  );
  assert.ok(!screen.queryByRole('button', { name: t('collapsePanel') }));
});

test('choosing a resident panel in the summary while a tray panel is open collapses back to the layout', async () => {
  const user = renderWorkbench();
  const tray = await screen.findByRole('region', { name: t('panelTray') });
  await user.click(within(tray).getByRole('button', { name: titled('first-ephemeral') }));
  assert.ok(screen.getByRole('button', { name: t('collapsePanel') }));
  await user.click(screen.getByRole('button', { name: summaryEntryName(2, 'done') }));
  await user.click(
    within(screen.getByRole('dialog', { name: t('done') })).getByRole('button', { name: titled('resident') }),
  );
  assert.deepEqual(
    within(tray)
      .getAllByRole('button')
      .map(card => card.getAttribute('aria-pressed')),
    ['false', 'false'],
  );
  assert.ok(!screen.queryByRole('button', { name: t('collapsePanel') }));
  assert.ok(
    screen.getByRole('button', { name: t('enlargePanel') }),
    'the resident panel is not maximized in place of the tray panel',
  );
});

test('the summary is not shown on the settings page, the project creation guide or the welcome page', async () => {
  const user = renderWorkbench();
  await screen.findByRole('region', { name: t('projectSummary') });
  await user.click(screen.getByRole('button', { name: t('settings') }));
  await screen.findByRole('button', { name: t('back') });
  assert.ok(!screen.queryByRole('region', { name: t('projectSummary') }));
  cleanup();

  renderWorkbench(snapshot => {
    snapshot.activeProjectId = null;
  });
  await screen.findByRole('button', { name: t('createProject') });
  assert.ok(!screen.queryByRole('region', { name: t('projectSummary') }));
  cleanup();

  renderWorkbench(snapshot => {
    snapshot.projects = [];
    snapshot.activeProjectId = null;
  });
  await screen.findByRole('textbox', { name: t('projectName') });
  assert.ok(!screen.queryByRole('region', { name: t('projectSummary') }));
});
