import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createRef, useEffect, useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectSummary } from '../../app/renderer/ProjectSummary';
import { Localization } from '../../app/renderer/Localization';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/SettingsPage';
import { defaultSettings } from '../../app/shared/settings';
import type { PanelView, Snapshot, WorkbenchEvent } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';
import type { DesktopAPI } from '../../app/shared/api';
import type { SettingsSaveResult } from '../../app/shared/settings';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);

const panel = (id: string, status: ProcessingState): PanelView =>
  ({ id, agent: 'codex', run: { id, panelId: id, projectId: 'project', state: 'running', title: `Session ${id}` }, status });

function fixture(saveSettings?: DesktopAPI['saveSettings']) {
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 }, activeProjectId: 'project', settings: defaultSettings(),
    settingsConflicts: [], startupTheme: 'light', resolvedTheme: 'light', errors: [],
    projects: [{ id: 'project', name: 'Project title stays out of the bar', directory: '/project', layout: null,
      panels: ([['first', 'done'], ['second', 'done'], ['third', 'needs-input'], ['fresh', 'ready']] as const).map(([id, status]) => panel(id, status)) }],
  };
  const listeners = new Set<(event: WorkbenchEvent) => void>();
  const located: (string | undefined)[][] = [];
  const settings = createRef<SettingsPageActions>();
  provideWorkbench({ snapshot: async () => structuredClone(snapshot),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    saveSettings,
  });
  function Summary() {
    const [state, setState] = useState<Snapshot>();
    useEffect(() => {
      void window.workbench.snapshot().then(setState);
      return window.workbench.subscribe(event => { if (event.kind === 'snapshot') setState(event.snapshot); });
    }, []);
    const active = state?.projects.find(project => project.id === state.activeProjectId);
    return <Localization language={state?.settings.language ?? 'en'}><button>Outside</button>
      {saveSettings && state && <SettingsPage initialCategory="agents" ref={settings} settings={state.settings} startupTheme="light" report={() => {}} back={() => {}} />}
      <ProjectSummary projectId={active?.id} panels={active?.panels} locatePanel={(...target) => {
        if (saveSettings) void settings.current!.requestLeave().then(leave => { if (leave) located.push(target); });
        else located.push(target);
      }} /></Localization>;
  }
  render(<Summary />);
  return { snapshot, panels: () => snapshot.projects[0].panels, located, user: userEvent.setup(),
    update: async () => act(() => { for (const listener of listeners) listener({ kind: 'snapshot', snapshot: structuredClone(snapshot) }); }),
  };
}

test('summary counts the current project\'s panels by state in fixed order and always lists members before locating, even one result', async () => {
  const { user, located } = fixture();
  const bar = await screen.findByRole('region', { name: 'Current project summary' });
  await screen.findByRole('button', { name: '1 Needs input' });
  assert.deepEqual(within(bar).getAllByRole('button').map(button => button.textContent), ['1 Ready', '1 Needs input', '2 Done', '0 Error']);
  assert.equal(bar.textContent?.includes('Project title'), false);
  for (const entry of within(bar).getAllByRole('button')) assert.equal(entry.title, entry.getAttribute('aria-label'), 'names survive a collapse to icon and count');
  assert.equal(within(bar).getByRole<HTMLButtonElement>('button', { name: '0 Error' }).disabled, true);
  await user.click(within(bar).getByRole('button', { name: '1 Needs input' }));
  const list = screen.getByRole('dialog', { name: 'Needs input' });
  assert.equal(located.length, 0);
  assert.equal(within(list).getAllByRole('listitem').length, 1);
  await user.click(within(list).getByRole('button', { name: /Session third/ }));
  assert.deepEqual(located, [['project', 'third', 'third']]);
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(within(bar).getByRole('button', { name: '1 Ready' }));
  await user.click(within(screen.getByRole('dialog', { name: 'Ready' })).getByRole('button', { name: /Session fresh/ }));
  assert.deepEqual(located.at(-1), ['project', 'fresh', 'fresh']);
});

test('keyboard users can choose members, switch lists and return to the triggering entry on Escape or close', async () => {
  const { user, located } = fixture();
  const done = await screen.findByRole('button', { name: '2 Done' });
  done.focus(); await user.keyboard('{Enter}');
  assert.match(document.activeElement!.textContent!, /Session first/);
  await user.keyboard('{ArrowDown}');
  assert.match(document.activeElement!.textContent!, /Session second/);
  await user.keyboard('{Home}'); assert.match(document.activeElement!.textContent!, /Session first/);
  await user.keyboard('{End}'); assert.match(document.activeElement!.textContent!, /Session second/);
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog')); assert.equal(document.activeElement, done);
  await user.keyboard(' ');
  await user.click(screen.getByRole('button', { name: 'Close panel list' }));
  assert.equal(document.activeElement, done);
  await user.click(done);
  await user.click(screen.getByRole('button', { name: '1 Needs input' }));
  assert.equal(screen.queryByRole('dialog', { name: 'Done' }), null);
  assert.ok(screen.getByRole('dialog', { name: 'Needs input' }));
  assert.equal(done.getAttribute('aria-expanded'), 'false');
  await user.click(screen.getByRole('button', { name: '1 Needs input' }));
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(done); await user.click(screen.getByRole('button', { name: 'Outside' }));
  assert.ok(!screen.queryByRole('dialog'));
  done.focus(); await user.keyboard('{ArrowUp}{ArrowDown}{Enter}');
  assert.deepEqual(located, [['project', 'first', 'first']]);
});

test('open lists follow live membership and titles, retain keyboard control after removal, and reset on project changes', async () => {
  const { user, snapshot, panels, update, located } = fixture();
  await user.click(await screen.findByRole('button', { name: '2 Done' }));
  panels()[1].run!.title = 'Renamed session';
  panels()[0].status = 'busy';
  await update();
  assert.ok(screen.getByRole('button', { name: '1 Done' }));
  const list = screen.getByRole('dialog');
  assert.equal(within(list).queryByRole('button', { name: /Session first/ }), null);
  assert.ok(document.activeElement === within(list).getByRole('button', { name: /Renamed session/ }));
  panels()[1].status = 'ready';
  await update();
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: '0 Done' }).disabled, true);
  assert.ok(document.activeElement === screen.getByRole('button', { name: 'Close panel list' }));
  await user.keyboard('{Escape}');
  assert.ok(!screen.queryByRole('dialog'));
  await user.click(screen.getByRole('button', { name: '1 Needs input' }));
  snapshot.activeProjectId = null;
  await update();
  assert.ok(!screen.queryByRole('dialog'));
  assert.equal(screen.getByRole('region', { name: 'Current project summary' }).textContent, '');
  assert.deepEqual(located, []);
  snapshot.activeProjectId = 'project';
  await update();
  assert.ok(screen.getByRole('button', { name: '1 Needs input' }));
  assert.ok(!screen.queryByRole('dialog'));
});

test('clicking blank space in the bottom bar dismisses the list', async () => {
  const { user } = fixture();
  const done = await screen.findByRole('button', { name: '2 Done' });
  await user.click(done);
  await user.click(done.parentElement!);
  assert.ok(!screen.queryByRole('dialog'));
});

test('language changes update an open list without replacing it or translating real session titles', async () => {
  const { user, snapshot, panels, update, located } = fixture();
  await screen.findByRole('button', { name: '2 Done' });
  delete panels()[0].run!.title;
  panels()[1].run!.title = 'Untitled task';
  await update();
  await user.click(screen.getByRole('button', { name: '2 Done' }));
  const list = screen.getByRole('dialog', { name: 'Done' });
  const members = within(list).getAllByRole('listitem');
  assert.equal(members[0].textContent, 'Untitled taskCodex');
  assert.equal(members[1].textContent, 'Untitled taskCodex');
  await user.keyboard('{ArrowDown}');
  snapshot.settings.language = 'zh-CN';
  await update();
  assert.equal(screen.getByRole('dialog', { name: '本轮结束' }), list);
  assert.equal(within(list).getAllByRole('listitem')[0], members[0]);
  assert.equal(members[0].textContent, '未命名任务Codex');
  assert.equal(members[1].textContent, 'Untitled taskCodex');
  assert.equal(document.activeElement, members[1].querySelector('button'));
  assert.ok(screen.getByRole('button', { name: '1 等待输入' }));
  await user.keyboard('{Enter}');
  assert.deepEqual(located, [['project', 'second', 'second']]);
});

test('a pending settings save protects edits and leave requests and preserves the selected run even if its list member disappears', async () => {
  const pending = deferred<SettingsSaveResult>();
  const patches: Parameters<DesktopAPI['saveSettings']>[0][] = [];
  const { user, snapshot, update, located } = fixture(patch => { patches.push(patch); return pending.promise; });
  await screen.findByRole('button', { name: '2 Done' });
  const input = screen.getAllByRole<HTMLInputElement>('textbox', { name: 'Launch command' })[0];
  await user.type(input, '-draft');
  await user.click(screen.getByRole('button', { name: '2 Done' }));
  await user.click(screen.getByRole('button', { name: /Session first/ }));
  await user.click(screen.getByRole('button', { name: 'Save and return' }));
  assert.equal(patches.length, 1);
  await user.type(input, '-ignored');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('button', { name: 'Appearance' }));
  assert.equal(input.value, 'codex-draft');
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: '‹ Back' }).disabled, true);
  await user.click(screen.getByRole('button', { name: '2 Done' }));
  await user.click(screen.getByRole('button', { name: /Session second/ }));
  assert.deepEqual(located, []);
  assert.equal(patches.length, 1);
  snapshot.projects[0].panels = snapshot.projects[0].panels.filter(panel => panel.id !== 'first');
  await update();
  await act(async () => { pending.resolve({ ok: true, settings: { ...snapshot.settings, ...patches[0] } }); });
  // The locator receives the original identity and can reject it; the list must
  // never replace that accepted intent with the survivor or the second click.
  assert.deepEqual(located, [['project', 'first', 'first']]);
});
