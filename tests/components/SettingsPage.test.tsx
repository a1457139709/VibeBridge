import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/settings/SettingsPage';
import { defaultSettings, type SettingsSaveResult } from '../../app/shared/settings/settings';
import type { CommandCheck, Settings } from '../../app/shared/model';
import { message } from '../../app/shared/messages';
import { deferred, provideWorkbench } from './support/workbench';
import { requireValue } from '../../app/renderer/common/required';
import { descriptionParts } from './support/elements';
import { t } from './support/localization';
import { click, command, renderSettings, startsWith } from './support/settings-page';

afterEach(cleanup);

test('category drafts survive switching, and ordinary save submits only the current category', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({
    ok: true as const,
    settings: { ...saved, ...patch },
  }));
  provideWorkbench({ saveSettings });
  const { user } = renderSettings(saved);
  await user.clear(command());
  await user.type(command(), '/draft-codex');
  await click(user, t('appearance'));
  await user.click(screen.getByRole('radio', { name: t('themeDark') }));
  await user.selectOptions(screen.getByRole('combobox', { name: t('defaultLayout') }), 'column');
  const sidebar = within(screen.getByRole('radiogroup', { name: t('sidebarCoexistence') }));
  const detail = within(screen.getByRole('radiogroup', { name: t('detailCoexistence') }));
  assert.equal(
    sidebar.getByRole<HTMLInputElement>('radio', { name: startsWith(t('sidebarSqueeze')) }).checked,
    true,
    'the sidebar squeezes by default',
  );
  assert.equal(
    detail.getByRole<HTMLInputElement>('radio', { name: startsWith(t('detailOverlay')) }).checked,
    true,
    'a detail overlays by default',
  );
  await user.click(sidebar.getByRole('radio', { name: startsWith(t('sidebarOverlay')) }));
  await user.click(detail.getByRole('radio', { name: startsWith(t('detailSqueeze')) }));
  await click(user, t('agents'));
  assert.equal(command().value, '/draft-codex');
  await click(user, t('appearance'));
  await click(user, t('save'));
  assert.deepEqual(
    saveSettings.mock.calls.map(call => call.arguments),
    [[{ theme: 'dark', defaultLayout: 'column', sidebarCoexistence: 'overlay', detailCoexistence: 'squeeze' }]],
  );
  await click(user, t('agents'));
  assert.equal(command().value, '/draft-codex');
  await click(user, t('discardChanges'));
  assert.equal(command().value, 'codex');
  await click(user, t('appearance'));
  await click(user, t('restoreDefaults'));
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: t('themeSystem') }).checked, true);
  await click(user, t('discardChanges'));
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: t('themeDark') }).checked, true);
  assert.equal(saveSettings.mock.callCount(), 1);
});

test('settings from a newer snapshot become the saved settings that drafts are compared with and discarded to', async () => {
  provideWorkbench({});
  const ref = createRef<SettingsPageActions>();
  const props = { initialCategory: 'agents' as const, ref, back: () => {}, report: () => {} };
  const settings = defaultSettings();
  const { rerender } = render(<SettingsPage {...props} settings={settings} startupTheme={settings.theme} />);
  const user = userEvent.setup();
  const newer = {
    ...settings,
    agents: { ...settings.agents, codex: { ...settings.agents.codex, command: 'codex-new' } },
  };
  rerender(<SettingsPage {...props} settings={newer} startupTheme={settings.theme} />);
  await user.clear(command());
  await user.type(command(), 'codex-new');
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), true);
  await user.type(command(), '-draft');
  await click(user, t('discardChanges'));
  assert.equal(command().value, 'codex-new');
});

test('save and leave submits all changed categories together and allows leaving only after success', async () => {
  const saved = defaultSettings(),
    pending = deferred<SettingsSaveResult>();
  const saveSettings = mock.fn((_patch: Partial<Settings>) => pending.promise);
  provideWorkbench({ saveSettings });
  const { user, ref } = renderSettings(saved);
  await user.clear(command());
  await user.type(command(), '/new-codex');
  await click(user, t('appearance'));
  await user.click(screen.getByRole('radio', { name: t('themeDark') }));
  await click(user, t('shortcuts'));
  const binding = screen.getByRole('textbox', { name: t('nextPanel') });
  fireEvent.keyDown(binding, { key: 'k', code: 'KeyK', metaKey: true });
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  assert.deepEqual(descriptionParts(screen.getByRole('dialog')), [
    t('settingsUnsaved', { categories: [t('agents'), t('appearance'), t('shortcuts')] }),
  ]);
  await click(user, t('saveAndReturn'));
  const patch = {
    agents: { ...saved.agents, codex: { command: '/new-codex', args: [] } },
    theme: 'dark' as const,
    defaultLayout: 'auto' as const,
    sidebarCoexistence: 'squeeze' as const,
    detailCoexistence: 'overlay' as const,
    shortcuts: { ...saved.shortcuts, nextPanel: 'Command+K' },
  };
  assert.deepEqual(
    saveSettings.mock.calls.map(call => call.arguments),
    [[patch]],
  );
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), false);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: t('back') }).disabled, true);
  await act(async () => pending.resolve({ ok: true, settings: { ...saved, ...patch } }));
  assert.equal(await leave, true);
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), true);
});

test('validation failure reveals field errors, retains every draft and blocks leaving until corrected', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (_patch: Partial<Settings>): Promise<SettingsSaveResult> => ({
    ok: false,
    kind: 'validation',
    issues: [
      { category: 'agents', field: 'agents.codex.command', code: 'required', message: message('commandRequired') },
    ],
  }));
  provideWorkbench({ saveSettings });
  const { user, ref, report } = renderSettings(saved);
  await user.clear(command());
  await click(user, t('appearance'));
  await user.click(screen.getByRole('radio', { name: t('themeDark') }));
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await click(user, t('saveAndReturn'));
  assert.equal(await leave, false);
  assert.equal(command().value, '');
  assert.equal(command().getAttribute('aria-invalid'), 'true');
  assert.equal(screen.getByRole('textbox', { name: t('launchCommand'), description: t('commandRequired') }), command());
  assert.deepEqual(
    screen.getAllByRole('alert').map(alert => alert.textContent),
    [t('settingsInvalid'), t('commandRequired')],
  );
  assert.deepEqual(report.mock.calls[0].arguments, [t('settingsInvalid')]);
  await click(user, t('appearance'));
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: t('themeDark') }).checked, true);
  await click(user, t('agents'));
  await user.type(command(), '/fixed');
  assert.notEqual(command().getAttribute('aria-invalid'), 'true');
});

test('storage and unavailable failures keep drafts and block leaving, then allow a successful retry', async () => {
  for (const kind of ['storage', 'unavailable'] as const) {
    const saved = defaultSettings();
    const failure = message('settingsWriteFailed');
    provideWorkbench({ saveSettings: async () => ({ ok: false, kind, message: failure }) });
    const { user, ref, report } = renderSettings(saved);
    await user.clear(command());
    await user.type(command(), '/preserved');
    let leave!: Promise<boolean>;
    act(() => {
      leave = requireValue(ref.current, 'the settings page').requestLeave();
    });
    await click(user, t('saveAndReturn'));
    assert.equal(await leave, false);
    assert.equal(command().value, '/preserved');
    assert.equal(screen.getByRole('alert').textContent, t('settingsWriteFailed'));
    assert.deepEqual(
      report.mock.calls.map(call => call.arguments),
      [[t('settingsWriteFailed')]],
    );
    const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({
      ok: true as const,
      settings: { ...saved, ...patch },
    }));
    provideWorkbench({ saveSettings });
    act(() => {
      leave = requireValue(ref.current, 'the settings page').requestLeave();
    });
    await click(user, t('saveAndReturn'));
    assert.equal(await leave, true);
    assert.deepEqual(saveSettings.mock.calls[0].arguments, [
      { agents: { ...saved.agents, codex: { command: '/preserved', args: [] } } },
    ]);
    cleanup();
  }
});

test('a pending ordinary save blocks repeated submissions and draft mutation', async () => {
  const saved = defaultSettings(),
    pending = deferred<SettingsSaveResult>();
  const saveSettings = mock.fn((_patch: Partial<Settings>) => pending.promise);
  provideWorkbench({ saveSettings });
  const { user, ref } = renderSettings(saved);
  await user.type(command(), '-edited');
  act(() => {
    fireEvent.submit(requireValue(command().closest('form'), 'the command form'));
    fireEvent.submit(requireValue(command().closest('form'), 'the command form'));
  });
  await click(user, t('save'));
  await click(user, t('appearance'));
  await click(user, t('discardChanges'));
  await user.type(command(), '-late');
  assert.equal(command().value, 'codex-edited');
  assert.equal(saveSettings.mock.callCount(), 1);
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), false);
  await act(async () =>
    pending.resolve({
      ok: true,
      settings: { ...saved, agents: { ...saved.agents, codex: { command: 'codex-edited', args: [] } } },
    }),
  );
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), true);
});

test('cancel keeps a draft, and discard allows leaving without saving', async () => {
  provideWorkbench({});
  const { user, ref } = renderSettings();
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), true);
  await user.type(command(), '-draft');
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), false);
  await click(user, t('cancel'));
  assert.equal(await leave, false);
  assert.equal(command().value, 'codex-draft');
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await click(user, t('dontSave'));
  assert.equal(await leave, true);
});

test('late command checks cannot replace feedback for a newer or discarded draft', async () => {
  const old = deferred<CommandCheck>();
  const checkCommand = mock.fn((value: string) =>
    value === 'codex' ? old.promise : Promise.resolve({ available: true as const, path: '/new-command' }),
  );
  provideWorkbench({ checkCommand });
  const { user } = renderSettings();
  const checkFirst = () => user.click(screen.getAllByRole('button', { name: t('checkCommand') })[0]);
  const available = t('commandAvailable', { path: '/new-command' });
  assert.equal(checkCommand.mock.callCount(), 0);
  await checkFirst();
  await user.clear(command());
  await user.type(command(), 'new');
  await checkFirst();
  assert.equal(screen.getByRole('textbox', { name: t('launchCommand'), description: available }), command());
  await act(async () => old.resolve({ available: false, message: 'stale result' }));
  assert.equal(screen.getByRole('textbox', { name: t('launchCommand'), description: available }), command());
  const discarded = deferred<CommandCheck>();
  provideWorkbench({ checkCommand: () => discarded.promise });
  await checkFirst();
  await click(user, t('discardChanges'));
  await act(async () => discarded.resolve({ available: true, path: '/discarded-command' }));
  assert.equal(command().value, 'codex');
  assert.equal(
    screen.queryByRole('textbox', {
      name: t('launchCommand'),
      description: t('commandAvailable', { path: '/discarded-command' }),
    }),
    null,
  );
});

function shortcutConflictSettings(): Settings {
  const settings = defaultSettings();
  return { ...settings, shortcuts: { ...settings.shortcuts, nextPanel: settings.shortcuts.closePanel } };
}

test('during a settings conflict every leave asks to fix the conflicting categories, even without drafts, and offers no way to leave unsaved', async () => {
  provideWorkbench({});
  const { user, ref } = renderSettings(shortcutConflictSettings());
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  const conflict = t('settingsLeaveConflict', { categories: [t('shortcuts')] });
  assert.deepEqual(descriptionParts(screen.getByRole('dialog')), [conflict]);
  assert.deepEqual(
    within(screen.getByRole('dialog'))
      .getAllByRole('button')
      .map(button => button.textContent),
    [t('cancel'), t('saveAndReturn')],
  );
  await click(user, t('cancel'));
  assert.equal(await leave, false);
  await user.type(command(), '-draft');
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  assert.deepEqual(descriptionParts(screen.getByRole('dialog')), [
    conflict,
    t('settingsUnsaved', { categories: [t('agents')] }),
  ]);
  await click(user, t('cancel'));
  assert.equal(await leave, false);
});

test('save and return during a settings conflict submits the conflicting category and stays on the conflicting field when it fails', async () => {
  const settings = shortcutConflictSettings();
  const saveSettings = mock.fn(async (_patch: Partial<Settings>): Promise<SettingsSaveResult> => ({
    ok: false,
    kind: 'validation',
    issues: [
      {
        category: 'shortcuts',
        field: 'shortcuts.nextPanel',
        code: 'conflict',
        message: message('shortcutConflict', { actions: [{ message: message('closePanel') }] }),
      },
      {
        category: 'shortcuts',
        field: 'shortcuts.closePanel',
        code: 'conflict',
        message: message('shortcutConflict', { actions: [{ message: message('nextPanel') }] }),
      },
    ],
  }));
  provideWorkbench({ saveSettings });
  const { user, ref } = renderSettings(settings);
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await click(user, t('saveAndReturn'));
  assert.equal(await leave, false);
  assert.deepEqual(
    saveSettings.mock.calls.map(call => call.arguments),
    [[{ shortcuts: settings.shortcuts }]],
  );
  assert.ok(screen.getByRole('heading', { name: t('categorySettings', { category: t('shortcuts') }) }));
  assert.equal(document.activeElement, screen.getByRole('textbox', { name: t('nextPanel') }));
  assert.equal(screen.getByRole('alert').textContent, t('settingsConflict'));
});
