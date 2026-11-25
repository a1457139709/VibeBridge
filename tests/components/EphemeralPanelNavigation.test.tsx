import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useProjectNavigation } from '../../app/renderer/projects/ProjectNavigation';
import { Localization } from '../../app/renderer/common/Localization';
import { defaultSettings } from '../../app/main/persistence/settings';
import type { PanelView, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import { provideWorkbench } from './support/workbench';
import { testForgeView } from './support/forge';
import { localize } from '../../app/shared/localization/localization';
import { t } from './support/localization';
import { nameIncluding } from './support/accessible-names';

afterEach(cleanup);

const zh = localize('zh-CN').t;
const title = (id: string) => `Session ${id}`;
const titled = (id: string) => nameIncluding(title(id));
const projectNames = ['Current', 'Other', 'Quiet'];

const panel = (projectId: string, id: string, status?: ProcessingState): PanelView => ({
  id,
  agent: 'codex',
  run: { id: `run-${id}`, panelId: id, projectId, state: 'running', title: title(id) },
  status,
});

const snapshot = (): Snapshot => ({
  navigation: { visible: true, width: 212 },
  forgeSidebar: { visible: false, width: 380 },
  activeProjectId: 'current',
  settings: defaultSettings(),
  settingsConflicts: [],
  startupTheme: 'light',
  resolvedTheme: 'light',
  errors: [],
  projects: [
    {
      id: 'current',
      name: 'Current',
      directory: '/current',
      layout: null,
      panels: [panel('current', 'resident', 'ready')],
      tray: [
        panel('current', 'waiting', 'needs-input'),
        panel('current', 'working', 'busy'),
        panel('current', 'finished', 'done'),
      ],
      repository: null,
      ...testForgeView,
    },
    {
      id: 'other',
      name: 'Other',
      directory: '/other',
      layout: null,
      panels: [panel('other', 'other-resident', 'ready')],
      tray: [panel('other', 'failed', 'error'), panel('other', 'idle', 'ready')],
      repository: null,
      ...testForgeView,
    },
    {
      id: 'quiet',
      name: 'Quiet',
      directory: '/quiet',
      layout: null,
      panels: [panel('quiet', 'quiet-resident', 'ready')],
      tray: [],
      repository: null,
      ...testForgeView,
    },
  ],
});

function renderNavigation(language: 'en' | 'zh-CN', state = snapshot()) {
  const located: string[] = [];
  const saved: unknown[] = [];
  provideWorkbench({
    subscribe: () => () => {},
    saveSidebar: async (sidebar, preferences) => {
      if (sidebar === 'navigation') saved.push(preferences);
    },
  });
  function Navigation() {
    const navigation = useProjectNavigation({
      snapshot: state,
      page: 'workbench',
      view: () => ({ selected: 'resident', maximized: 'finished' }),
      openProject: () => {},
      openBinding: () => {},
      locatePanel: (project, panelId) => located.push(`${project}/${panelId}`),
      openSetup: () => {},
      toggleSettings: () => {},
      widestOnResize: () => Infinity,
      report: () => {},
    });
    return navigation.sidebar;
  }
  const result = render(
    <Localization language={language}>
      <Navigation />
    </Localization>,
  );
  return { located, saved, result, user: userEvent.setup() };
}

const group = (count: number, translate = t) =>
  screen.getByRole('button', { name: nameIncluding(translate('ephemeralGroup', { count })) });
const attention = (count: number, states: string[], translate = t) =>
  translate('ephemeralGroupAttention', { group: translate('ephemeralGroup', { count }), states });

test("each project's ephemeral panels sit in a collapsed group below its resident panels that shows the states needing attention", async () => {
  const { user } = renderNavigation('en');
  const current = group(3);
  assert.equal(current.getAttribute('aria-expanded'), 'false');
  assert.equal(current.getAttribute('aria-label'), attention(3, [t('needs-input'), t('done')]));
  assert.deepEqual(
    within(current)
      .getAllByRole('img')
      .map(icon => icon.getAttribute('aria-label')),
    [t('needs-input'), t('done')],
  );
  assert.equal(screen.queryByRole('button', { name: titled('waiting') }), null);
  assert.ok(screen.getByRole('button', { name: titled('resident') }));
  assert.ok(
    current.compareDocumentPosition(screen.getByRole('button', { name: titled('resident') })) &
      Node.DOCUMENT_POSITION_PRECEDING,
  );

  await user.click(screen.getByRole('button', { name: t('expandProject', { name: 'Other' }) }));
  const other = group(2);
  assert.equal(other.getAttribute('aria-label'), attention(2, [t('error')]));

  await user.click(screen.getByRole('button', { name: t('expandProject', { name: 'Quiet' }) }));
  assert.ok(screen.getByRole('button', { name: titled('quiet-resident') }));
  assert.equal(
    document.querySelectorAll('.ephemeral-group').length,
    2,
    'a project without ephemeral panels has no group',
  );

  await user.click(current);
  assert.equal(current.getAttribute('aria-expanded'), 'true');
  const entries = within(screen.getByRole('group', { name: t('ephemeralPanels', { name: 'Current' }) })).getAllByRole(
    'button',
  );
  assert.deepEqual(
    entries.map(entry => entry.getAttribute('aria-label')),
    [
      t('panelStateTitle', { state: t('needs-input'), title: title('waiting') }),
      t('panelStateTitle', { state: t('busy'), title: title('working') }),
      t('panelStateTitle', { state: t('done'), title: title('finished') }),
    ],
  );
  assert.deepEqual(
    entries.map(entry => entry.getAttribute('aria-current')),
    [null, null, 'true'],
  );
  assert.deepEqual(
    within(current).queryAllByRole('img'),
    [],
    'the expanded group lists the states on its entries instead',
  );
});

test('the ephemeral group has no add entry', async () => {
  const { user } = renderNavigation('zh-CN');
  const current = group(3, zh);
  assert.equal(current.getAttribute('aria-label'), attention(3, [zh('needs-input'), zh('done')], zh));
  await user.click(current);
  const entries = screen.getByRole('group', { name: zh('ephemeralPanels', { name: 'Current' }) });
  assert.deepEqual(
    within(entries)
      .getAllByRole('button')
      .map(entry => entry.getAttribute('aria-label')),
    [
      zh('panelStateTitle', { state: zh('needs-input'), title: title('waiting') }),
      zh('panelStateTitle', { state: zh('busy'), title: title('working') }),
      zh('panelStateTitle', { state: zh('done'), title: title('finished') }),
    ],
    'the group lists only its panels',
  );
});

test('clicking an ephemeral entry locates that panel in its project', async () => {
  const { located, user } = renderNavigation('en');
  await user.click(screen.getByRole('button', { name: t('expandProject', { name: 'Other' }) }));
  await user.click(group(2));
  await user.click(screen.getByRole('button', { name: titled('failed') }));
  assert.deepEqual(located, ['other/failed']);
});

test('expanding or collapsing the ephemeral group stays in the interface and is not saved as a navigation preference', async () => {
  const { saved, result, user } = renderNavigation('en');
  await user.click(group(3));
  await user.click(group(3));
  await user.click(group(3));
  assert.equal(group(3).getAttribute('aria-expanded'), 'true');
  assert.deepEqual(saved, []);
  result.unmount();
  renderNavigation('en');
  assert.equal(group(3).getAttribute('aria-expanded'), 'false');
});

test("a project's panel count covers its resident and ephemeral panels", () => {
  renderNavigation('en');
  const counts = screen
    .getAllByRole('button', { name: name => projectNames.includes(name) })
    .map(link => [link.getAttribute('data-hint'), link.querySelector('small')?.textContent]);
  assert.deepEqual(counts, [
    [t('projectPanelCount', { name: 'Current', panels: t('panelCount', { count: 4 }) }), '4'],
    [t('projectPanelCount', { name: 'Other', panels: t('panelCount', { count: 3 }) }), '3'],
    [t('projectPanelCount', { name: 'Quiet', panels: t('panelCount', { count: 1 }) }), '1'],
  ]);
});
