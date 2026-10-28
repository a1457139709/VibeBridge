import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/SettingsPage';
import { defaultSettings, type SettingsSaveResult } from '../../app/shared/settings';
import { deferred, provideWorkbench } from './support/workbench';
import { message } from '../../app/shared/messages';
import type { Settings } from '../../app/shared/model';

afterEach(cleanup);

test('language is a category draft until save, and ordinary save preserves other drafts', async () => {
  const ref = createRef<SettingsPageActions>();
  const notices: string[] = [];
  function Harness() {
    const [settings, setSettings] = useState(defaultSettings);
    provideWorkbench({ saveSettings: async patch => {
      const next = { ...settings, ...patch }; setSettings(next);
      return { ok: true, settings: next };
    } });
    return <SettingsPage settings={settings} startupTheme="system" ref={ref} back={() => {}} report={text => notices.push(text)} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  const language = screen.getByRole('combobox', { name: 'Interface language' });
  await user.selectOptions(language, 'zh-CN');
  assert.ok(screen.getByRole('button', { name: 'General' }));
  await user.click(screen.getByRole('button', { name: 'Agent' }));
  const command = screen.getAllByRole<HTMLInputElement>('textbox', { name: 'Launch command' })[0];
  await user.type(command, '-draft');
  await user.click(screen.getByRole('button', { name: 'General' }));
  assert.equal(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Interface language' }).value, 'zh-CN');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  assert.ok(screen.getByRole('button', { name: '通用' }));
  await user.click(screen.getByRole('button', { name: 'Agent' }));
  assert.equal(screen.getAllByRole<HTMLInputElement>('textbox', { name: '启动命令' })[0].value, 'codex-draft');
  assert.deepEqual(notices, ['配置已保存']);
});

test('discard, restore defaults and cancel leave preserve the effective language until an entire submission succeeds', async () => {
  const ref = createRef<SettingsPageActions>();
  const pending = deferred<SettingsSaveResult>();
  const patches: Partial<Settings>[] = [];
  const saved = { ...defaultSettings(), language: 'zh-CN' as const };
  provideWorkbench({ saveSettings: patch => { patches.push(patch); return pending.promise; } });
  render(<SettingsPage settings={saved} startupTheme="system" ref={ref} back={() => {}} report={() => {}} />);
  const user = userEvent.setup();
  const language = screen.getByRole<HTMLSelectElement>('combobox', { name: '界面语言' });
  assert.deepEqual([...language.options].map(option => option.textContent), ['English', '简体中文']);
  await user.click(screen.getByRole('button', { name: '恢复默认设置' }));
  assert.equal(language.value, 'en');
  assert.ok(screen.getByRole('button', { name: '通用' }));
  await user.click(screen.getByRole('button', { name: '放弃更改' }));
  assert.equal(language.value, 'zh-CN');
  await user.selectOptions(language, 'en');
  let leave!: Promise<boolean>;
  act(() => { leave = ref.current!.requestLeave(); });
  await user.click(screen.getByRole('button', { name: '取消' }));
  assert.equal(await leave, false);
  assert.equal(language.value, 'en');
  await user.click(screen.getByRole('button', { name: 'Agent' }));
  await user.type(screen.getAllByRole('textbox', { name: '启动命令' })[0], '-draft');
  act(() => { leave = ref.current!.requestLeave(); });
  assert.match(screen.getByRole('dialog').textContent!, /通用、Agent/);
  await user.click(screen.getByRole('button', { name: '保存并返回' }));
  assert.deepEqual(patches, [{ language: 'en', agents: { ...saved.agents, codex: { command: 'codex-draft', args: [] } } }]);
  await user.click(screen.getByRole('button', { name: '通用' }));
  assert.equal(await ref.current!.requestLeave(), false);
  assert.ok(screen.getByRole<HTMLButtonElement>('button', { name: '保存' }).disabled);
  await act(async () => pending.resolve({ ok: false, kind: 'storage', message: message('settingsWriteFailed') }));
  assert.equal(await leave, false);
  assert.ok(screen.getByText('配置保存失败'));
  await user.click(screen.getByRole('button', { name: '通用' }));
  assert.equal(screen.getByRole<HTMLSelectElement>('combobox', { name: '界面语言' }).value, 'en');
  assert.equal(patches.length, 1);
});

test('validation keeps language drafts, translates command checks and conflicts, and applies all categories only on retry', async () => {
  const ref = createRef<SettingsPageActions>();
  const reports: string[] = [];
  let effective = defaultSettings();
  let attempts = 0;
  function Harness() {
    const [saved, setSaved] = useState(effective);
    provideWorkbench({ checkCommand: async () => ({ available: false, message: message('commandUnavailable', { reason: '/原样/path' }) }),
      saveSettings: async patch => {
        if (++attempts === 1) return { ok: false, kind: 'validation', issues: [{ category: 'agents', field: 'agents.codex.command', code: 'required', message: message('commandRequired') }] };
        effective = { ...saved, ...patch }; setSaved(effective); return { ok: true, settings: effective };
      } });
    return <SettingsPage settings={saved} startupTheme="system" ref={ref} back={() => {}} report={value => reports.push(value)} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Interface language' }), 'zh-CN');
  await user.click(screen.getByRole('button', { name: 'Agent' }));
  await user.clear(screen.getAllByRole('textbox', { name: 'Launch command' })[0]);
  let leave!: Promise<boolean>;
  act(() => { leave = ref.current!.requestLeave(); });
  await user.click(screen.getByRole('button', { name: 'Save and return' }));
  assert.equal(await leave, false);
  assert.equal(effective.language, 'en');
  assert.ok(screen.getByText('Launch command is required'));
  await user.type(screen.getAllByRole('textbox', { name: 'Launch command' })[0], '/fixed');
  act(() => { leave = ref.current!.requestLeave(); });
  await user.click(screen.getByRole('button', { name: 'Save and return' }));
  assert.equal(await leave, true);
  assert.equal(effective.language, 'zh-CN');
  assert.equal(reports.at(-1), '配置已保存');
  await user.click(screen.getAllByRole('button', { name: '检查命令' })[0]);
  assert.ok(screen.getByText('命令不可用，请检查程序路径及执行权限：/原样/path'));
  await user.click(screen.getByRole('button', { name: '快捷键' }));
  fireEvent.keyDown(screen.getByRole('textbox', { name: '切换到下一个面板' }), { key: 'c', code: 'KeyC', metaKey: true });
  assert.ok(screen.getByText('快捷键冲突：系统「复制」'));
});
