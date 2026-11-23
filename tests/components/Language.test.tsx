import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/settings/SettingsPage';
import { defaultSettings, type SettingsSaveResult } from '../../app/shared/settings/settings';
import { deferred, provideWorkbench } from './support/workbench';
import { message } from '../../app/shared/messages';
import type { Settings } from '../../app/shared/model';
import { requireValue } from '../../app/renderer/common/required';
import { localize } from '../../app/shared/localization/localization';
import { t } from './support/localization';

const zh = localize('zh-CN').t;
const dialogParagraphs = () =>
  [...screen.getByRole('dialog').querySelectorAll('p')].map(paragraph => paragraph.textContent);

afterEach(cleanup);

test('language is a category draft until save, and ordinary save preserves other drafts', async () => {
  const ref = createRef<SettingsPageActions>();
  const notices: string[] = [];
  function Harness() {
    const [settings, setSettings] = useState(defaultSettings);
    provideWorkbench({
      saveSettings: async patch => {
        const next = { ...settings, ...patch };
        setSettings(next);
        return { ok: true, settings: next };
      },
    });
    return (
      <SettingsPage
        settings={settings}
        startupTheme="system"
        ref={ref}
        back={() => {}}
        report={text => notices.push(text)}
      />
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  const language = screen.getByRole('combobox', { name: t('language') });
  await user.selectOptions(language, 'zh-CN');
  assert.ok(screen.getByRole('button', { name: t('general') }));
  await user.click(screen.getByRole('button', { name: t('agents') }));
  const command = screen.getAllByRole<HTMLInputElement>('textbox', { name: t('launchCommand') })[0];
  await user.type(command, '-draft');
  await user.click(screen.getByRole('button', { name: t('general') }));
  assert.equal(screen.getByRole<HTMLSelectElement>('combobox', { name: t('language') }).value, 'zh-CN');
  await user.click(screen.getByRole('button', { name: t('save') }));
  assert.ok(screen.getByRole('button', { name: zh('general') }));
  await user.click(screen.getByRole('button', { name: t('agents') }));
  assert.equal(screen.getAllByRole<HTMLInputElement>('textbox', { name: zh('launchCommand') })[0].value, 'codex-draft');
  assert.deepEqual(notices, [zh('settingsSaved')]);
});

test('discard, restore defaults and cancel leave preserve the effective language until an entire submission succeeds', async () => {
  const ref = createRef<SettingsPageActions>();
  const pending = deferred<SettingsSaveResult>();
  const patches: Partial<Settings>[] = [];
  const saved = { ...defaultSettings(), language: 'zh-CN' as const };
  provideWorkbench({
    saveSettings: patch => {
      patches.push(patch);
      return pending.promise;
    },
  });
  render(<SettingsPage settings={saved} startupTheme="system" ref={ref} back={() => {}} report={() => {}} />);
  const user = userEvent.setup();
  const language = screen.getByRole<HTMLSelectElement>('combobox', { name: zh('language') });
  assert.deepEqual(
    [...language.options].map(option => [option.value, option.lang]),
    [
      ['en', 'en'],
      ['zh-CN', 'zh-CN'],
    ],
    'each language is offered in its own language',
  );
  await user.click(screen.getByRole('button', { name: zh('restoreDefaults') }));
  assert.equal(language.value, 'en');
  assert.ok(screen.getByRole('button', { name: zh('general') }));
  await user.click(screen.getByRole('button', { name: zh('discardChanges') }));
  assert.equal(language.value, 'zh-CN');
  await user.selectOptions(language, 'en');
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await user.click(screen.getByRole('button', { name: zh('cancel') }));
  assert.equal(await leave, false);
  assert.equal(language.value, 'en');
  await user.click(screen.getByRole('button', { name: t('agents') }));
  await user.type(screen.getAllByRole('textbox', { name: zh('launchCommand') })[0], '-draft');
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  assert.deepEqual(dialogParagraphs(), [zh('settingsUnsaved', { categories: [zh('general'), zh('agents')] })]);
  await user.click(screen.getByRole('button', { name: zh('saveAndReturn') }));
  assert.deepEqual(patches, [
    { language: 'en', agents: { ...saved.agents, codex: { command: 'codex-draft', args: [] } } },
  ]);
  await user.click(screen.getByRole('button', { name: zh('general') }));
  assert.equal(await requireValue(ref.current, 'the settings page').requestLeave(), false);
  assert.ok(screen.getByRole<HTMLButtonElement>('button', { name: zh('save') }).disabled);
  await act(async () => pending.resolve({ ok: false, kind: 'storage', message: message('settingsWriteFailed') }));
  assert.equal(await leave, false);
  assert.equal(screen.getByRole('alert').textContent, zh('settingsWriteFailed'));
  await user.click(screen.getByRole('button', { name: zh('general') }));
  assert.equal(screen.getByRole<HTMLSelectElement>('combobox', { name: zh('language') }).value, 'en');
  assert.equal(patches.length, 1);
});

test('validation keeps language drafts, translates command checks and conflicts, and applies all categories only on retry', async () => {
  const ref = createRef<SettingsPageActions>();
  const reports: string[] = [];
  let effective = defaultSettings();
  let attempts = 0;
  function Harness() {
    const [saved, setSaved] = useState(effective);
    provideWorkbench({
      checkCommand: async () => ({
        available: false,
        message: message('commandUnavailable', { reason: '/原样/path' }),
      }),
      saveSettings: async patch => {
        if (++attempts === 1)
          return {
            ok: false,
            kind: 'validation',
            issues: [
              {
                category: 'agents',
                field: 'agents.codex.command',
                code: 'required',
                message: message('commandRequired'),
              },
            ],
          };
        effective = { ...saved, ...patch };
        setSaved(effective);
        return { ok: true, settings: effective };
      },
    });
    return (
      <SettingsPage
        settings={saved}
        startupTheme="system"
        ref={ref}
        back={() => {}}
        report={value => reports.push(value)}
      />
    );
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: t('language') }), 'zh-CN');
  await user.click(screen.getByRole('button', { name: t('agents') }));
  await user.clear(screen.getAllByRole('textbox', { name: t('launchCommand') })[0]);
  let leave!: Promise<boolean>;
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await user.click(screen.getByRole('button', { name: t('saveAndReturn') }));
  assert.equal(await leave, false);
  assert.equal(effective.language, 'en');
  assert.ok(screen.getByRole('textbox', { name: t('launchCommand'), description: t('commandRequired') }));
  await user.type(screen.getAllByRole('textbox', { name: t('launchCommand') })[0], '/fixed');
  act(() => {
    leave = requireValue(ref.current, 'the settings page').requestLeave();
  });
  await user.click(screen.getByRole('button', { name: t('saveAndReturn') }));
  assert.equal(await leave, true);
  assert.equal(effective.language, 'zh-CN');
  assert.equal(reports.at(-1), zh('settingsSaved'));
  await user.click(screen.getAllByRole('button', { name: zh('checkCommand') })[0]);
  assert.ok(
    screen.getByRole('textbox', {
      name: zh('launchCommand'),
      description: zh('commandUnavailable', { reason: '/原样/path' }),
    }),
  );
  await user.click(screen.getByRole('button', { name: zh('shortcuts') }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: zh('nextPanel') }), {
    key: 'c',
    code: 'KeyC',
    metaKey: true,
  });
  assert.ok(
    screen.getByRole('textbox', {
      name: zh('nextPanel'),
      description: zh('shortcutConflict', { actions: [zh('systemShortcut', { action: zh('copy') })] }),
    }),
  );
});
