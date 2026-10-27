import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { useEffect, useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useProjectNavigation } from '../../app/renderer/ProjectNavigation';
import { Localization } from '../../app/renderer/Localization';
import { defaultSettings } from '../../app/main/settings';
import type { Snapshot, WorkbenchEvent } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

test('navigation reads the shared projection, exposes all five states to keyboard users, and keeps background updates', async () => {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, activeProjectId: 'project', settings: defaultSettings(),
    defaultShortcutConflict: false, startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Project', directory: '/project', layout: null,
      panels: ['ready', 'busy', 'needs-input', 'done', 'error', 'starting'].map(id => ({ id, agent: 'codex' })) }],
    runs: ['ready', 'busy', 'needs-input', 'done', 'error', 'starting'].map(id => ({ id, panelId: id, projectId: 'project', state: id === 'starting' ? 'starting' : 'running', rawTitle: `Session ${id} | project` })),
    processing: { runs: { ready: 'ready', busy: 'busy', 'needs-input': 'needs-input', done: 'done', error: 'error' },
      projects: { project: { ready: { count: 1, members: [{ panelId: 'ready', runId: 'ready' }] }, 'needs-input': { count: 1, members: [{ panelId: 'needs-input', runId: 'needs-input' }] },
        done: { count: 1, members: [{ panelId: 'done', runId: 'done' }] }, error: { count: 1, members: [{ panelId: 'error', runId: 'error' }] } } } },
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const located: string[] = [];
  provideWorkbench({ snapshot: async () => structuredClone(snapshot),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveNavigation: async navigation => { snapshot.navigation = navigation; },
  });
  function Navigation() {
    const [state, setState] = useState<Snapshot>();
    useEffect(() => {
      void window.workbench.snapshot().then(setState);
      return window.workbench.subscribe(event => { if (event.kind === 'snapshot') setState(event.snapshot); });
    }, []);
    return <Localization language={state?.settings.language ?? 'en'}><NavigationView state={state} /></Localization>;
  }
  function NavigationView({ state }: { state?: Snapshot }) {
    const navigation = useProjectNavigation({ snapshot: state, page: 'workbench', view: () => ({ selected: 'done' }),
      openProject: () => {}, locatePanel: (_project, panel) => located.push(panel), createProject: () => {}, toggleSettings: () => {}, report: () => {} });
    return <>{navigation.toggle}{navigation.sidebar}</>;
  }
  render(<Navigation />);
  const user = userEvent.setup();
  for (const label of ['Ready', 'Busy', 'Needs input', 'Done', 'Error']) {
    const icon = await screen.findByRole('img', { name: label });
    const entry = icon.closest('button')!;
    assert.ok(entry.getAttribute('title')?.includes(label));
    for (let step = 0; document.activeElement !== entry && step < 20; step++) await user.tab();
    assert.equal(document.activeElement, entry);
  }
  const starting = screen.getByRole('button', { name: 'Session starting' });
  assert.equal(within(starting).queryByRole('img'), null);
  await user.click(screen.getByRole('button', { name: /Done.*Session done/ }));
  assert.deepEqual(located, ['done']);
  assert.ok(screen.getByRole('img', { name: 'Done' }));
  const icons = screen.getAllByRole('img');
  const chinese = structuredClone(snapshot);
  chinese.settings.language = 'zh-CN';
  await act(async () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: chinese }); });
  assert.deepEqual(screen.getAllByRole('img'), icons);
  for (const label of ['就绪', '处理中', '等待输入', '本轮结束', '异常']) {
    const icon = screen.getByRole('img', { name: label });
    assert.ok(icon.closest('button')!.getAttribute('title')?.includes(label));
  }
  await act(async () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot }); });
  await user.click(screen.getByRole('button', { name: 'Collapse project navigation' }));
  assert.equal(screen.getByRole('button', { name: 'Expand project navigation' }).getAttribute('aria-expanded'), 'false');
  const updated = structuredClone(snapshot);
  updated.activeProjectId = 'elsewhere';
  updated.processing.runs.busy = 'needs-input';
  updated.processing.projects.project['needs-input'] = { count: 2, members: [{ panelId: 'busy', runId: 'busy' }, { panelId: 'needs-input', runId: 'needs-input' }] };
  await act(async () => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: updated }); });
  await user.click(screen.getByRole('button', { name: 'Expand project navigation' }));
  assert.equal(screen.getAllByRole('img', { name: 'Needs input' }).length, 2);
  assert.ok(screen.getByRole('img', { name: 'Done' }));
});
