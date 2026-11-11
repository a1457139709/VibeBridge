import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useProjectNavigation } from '../../app/renderer/ProjectNavigation';
import { Localization } from '../../app/renderer/Localization';
import { defaultSettings } from '../../app/main/settings';
import type { PanelView, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const panel = (projectId: string, id: string, status?: ProcessingState): PanelView =>
  ({ id, agent: 'codex', run: { id: `run-${id}`, panelId: id, projectId, state: 'running', title: `Session ${id}` }, status });

const snapshot = (): Snapshot => ({
  navigation: { visible: true, width: 212 }, activeProjectId: 'current', settings: defaultSettings(),
  settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
  projects: [
    { id: 'current', name: 'Current', directory: '/current', layout: null, panels: [panel('current', 'resident', 'ready')],
      tray: [panel('current', 'waiting', 'needs-input'), panel('current', 'working', 'busy'), panel('current', 'finished', 'done')], repository: null },
    { id: 'other', name: 'Other', directory: '/other', layout: null, panels: [panel('other', 'other-resident', 'ready')],
      tray: [panel('other', 'failed', 'error'), panel('other', 'idle', 'ready')], repository: null },
    { id: 'quiet', name: 'Quiet', directory: '/quiet', layout: null, panels: [panel('quiet', 'quiet-resident', 'ready')], tray: [], repository: null },
  ],
});

function renderNavigation(language: 'en' | 'zh-CN', state = snapshot()) {
  const located: string[] = [];
  const saved: unknown[] = [];
  provideWorkbench({ subscribe: () => () => {}, saveNavigation: async navigation => { saved.push(navigation); } });
  function Navigation() {
    const navigation = useProjectNavigation({ snapshot: state, page: 'workbench', view: () => ({ selected: 'resident', maximized: 'finished' }),
      openProject: () => {}, locatePanel: (project, panelId) => located.push(`${project}/${panelId}`),
      createProject: () => {}, toggleSettings: () => {}, report: () => {} });
    return navigation.sidebar;
  }
  const result = render(<Localization language={language}><Navigation /></Localization>);
  return { located, saved, result, user: userEvent.setup() };
}

const group = (name: RegExp) => screen.getByRole('button', { name });

test('each project\'s ephemeral panels sit in a collapsed group below its resident panels that shows the states needing attention', async () => {
  const { user } = renderNavigation('en');
  const current = group(/^Ephemeral · 3/);
  assert.equal(current.getAttribute('aria-expanded'), 'false');
  assert.equal(current.getAttribute('aria-label'), 'Ephemeral · 3 · Needs input, Done');
  assert.deepEqual(within(current).getAllByRole('img').map(icon => icon.getAttribute('aria-label')), ['Needs input', 'Done']);
  assert.equal(screen.queryByRole('button', { name: /Session waiting/ }), null);
  assert.ok(screen.getByRole('button', { name: /Session resident/ }));
  assert.ok(current.compareDocumentPosition(screen.getByRole('button', { name: /Session resident/ })) & Node.DOCUMENT_POSITION_PRECEDING);

  await user.click(screen.getByRole('button', { name: 'Expand project panels: Other' }));
  const other = group(/^Ephemeral · 2/);
  assert.equal(other.getAttribute('aria-label'), 'Ephemeral · 2 · Error');

  await user.click(screen.getByRole('button', { name: 'Expand project panels: Quiet' }));
  assert.ok(screen.getByRole('button', { name: /Session quiet-resident/ }));
  assert.equal(screen.getAllByRole('button', { name: /^Ephemeral/ }).length, 2, 'a project without ephemeral panels has no group');

  await user.click(current);
  assert.equal(current.getAttribute('aria-expanded'), 'true');
  const entries = within(screen.getByRole('group', { name: 'Ephemeral panels in Current' })).getAllByRole('button');
  assert.deepEqual(entries.map(entry => entry.getAttribute('aria-label')), ['Needs input · Session waiting', 'Busy · Session working', 'Done · Session finished']);
  assert.deepEqual(entries.map(entry => entry.getAttribute('aria-current')), [null, null, 'true']);
  assert.deepEqual(within(current).queryAllByRole('img'), [], 'the expanded group lists the states on its entries instead');
});

test('the ephemeral group has no add entry', async () => {
  const { user } = renderNavigation('zh-CN');
  const current = group(/^临时 · 3/);
  assert.equal(current.getAttribute('aria-label'), '临时 · 3 · 等待输入、本轮结束');
  await user.click(current);
  const entries = screen.getByRole('group', { name: 'Current的临时面板' });
  assert.equal(within(entries).queryByText(/＋/), null);
  assert.equal(within(entries).queryByRole('button', { name: /添加|新增/ }), null);
  assert.equal(within(entries).getAllByRole('button').length, 3);
});

test('clicking an ephemeral entry locates that panel in its project', async () => {
  const { located, user } = renderNavigation('en');
  await user.click(screen.getByRole('button', { name: 'Expand project panels: Other' }));
  await user.click(group(/^Ephemeral · 2/));
  await user.click(screen.getByRole('button', { name: 'Error · Session failed' }));
  assert.deepEqual(located, ['other/failed']);
});

test('expanding or collapsing the ephemeral group stays in the interface and is not saved as a navigation preference', async () => {
  const { saved, result, user } = renderNavigation('en');
  await user.click(group(/^Ephemeral · 3/));
  await user.click(group(/^Ephemeral · 3/));
  await user.click(group(/^Ephemeral · 3/));
  assert.equal(group(/^Ephemeral · 3/).getAttribute('aria-expanded'), 'true');
  assert.deepEqual(saved, []);
  result.unmount();
  renderNavigation('en');
  assert.equal(group(/^Ephemeral · 3/).getAttribute('aria-expanded'), 'false');
});

test('a project\'s panel count covers its resident and ephemeral panels', () => {
  renderNavigation('en');
  const counts = screen.getAllByRole('button', { name: /^(Current|Other|Quiet)$/ })
    .map(link => [link.getAttribute('data-hint'), link.querySelector('small')?.textContent]);
  assert.deepEqual(counts, [['Current · 4 panels', '4'], ['Other · 3 panels', '3'], ['Quiet · 1 panels', '1']]);
});
