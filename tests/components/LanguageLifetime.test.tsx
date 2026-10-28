import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { defaultSettings } from '../../app/shared/settings';
import { newDraft } from '../../app/shared/model';
import { message } from '../../app/shared/messages';
import { Localization } from '../../app/renderer/Localization';
import { Notices, useNotices } from '../../app/renderer/Notices';
import { SettingsPage } from '../../app/renderer/SettingsPage';
import { Setup } from '../../app/renderer/Setup';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

test('switching language preserves project input and old notice identity and expiry while the save notice uses the new language', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  function Harness() {
    const [settings, setSettings] = useState(defaultSettings);
    const [draft, setDraft] = useState(newDraft);
    const { notices, report, dismiss } = useNotices();
    provideWorkbench({ chooseDirectory: async () => { throw new Error(message('environmentFailed')); },
      saveSettings: async patch => { const next = { ...settings, ...patch }; setSettings(next); return { ok: true, settings: next }; } });
    return <Localization language={settings.language}>
      <Setup draft={draft} change={setDraft} defaultLayout="auto" cancel={() => {}} created={() => {}} openProject={() => {}} report={report} openAgentSettings={() => {}} />
      <SettingsPage settings={settings} startupTheme="system" ref={null} back={() => {}} report={report} />
      <Notices notices={notices} dismiss={dismiss} />
    </Localization>;
  }
  render(<Harness />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' });
  fireEvent.change(input, { target: { value: 'Untitled task 原样' } });
  fireEvent.paste(input, { clipboardData: { getData: () => 'line\nbreak' } });
  assert.ok(screen.getByText('Project names cannot contain line breaks or control characters'));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose local directory' })); });
  const notice = screen.getByText('Could not read the local command environment').closest('[role=alert]');
  act(() => context.mock.timers.tick(4000));
  fireEvent.change(screen.getByRole('combobox', { name: 'Interface language' }), { target: { value: 'zh-CN' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: '项目名称' }), input);
  assert.equal(input.value, 'Untitled task 原样');
  assert.ok(screen.getByText('项目名称不能包含换行或控制字符'));
  assert.equal(screen.getByText('无法读取本机命令环境').closest('[role=alert]'), notice);
  assert.ok(screen.getByText('配置已保存'));
  act(() => context.mock.timers.tick(999));
  assert.ok(screen.getByText('无法读取本机命令环境'));
  act(() => context.mock.timers.tick(1));
  assert.equal(screen.queryByText('无法读取本机命令环境'), null);
  assert.ok(screen.getByText('配置已保存'));
  act(() => context.mock.timers.tick(1000));
  assert.equal(screen.queryByText('配置已保存'), null);
});
