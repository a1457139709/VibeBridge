import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/SettingsPage';
import { defaultSettings, type SettingsSaveResult } from '../../app/shared/settings';
import type { CommandCheck, Settings } from '../../app/shared/model';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);

function renderSettings(settings = defaultSettings()) {
  const ref = createRef<SettingsPageActions>();
  const report = mock.fn();
  render(<SettingsPage settings={settings} startupTheme={settings.theme} ref={ref} back={() => {}} report={report} />);
  return { user: userEvent.setup(), ref, report };
}
const click = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }));
const command = () => screen.getAllByRole<HTMLInputElement>('textbox', { name: '启动命令' })[0];

test('category drafts survive switching, and ordinary save submits only the current category', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({ ok: true as const, settings: { ...saved, ...patch } }));
  provideWorkbench({ saveSettings });
  const { user } = renderSettings(saved);
  await user.clear(command()); await user.type(command(), '/draft-codex');
  await click(user, '外观');
  await user.click(screen.getByRole('radio', { name: '深色' }));
  await user.selectOptions(screen.getByRole('combobox', { name: '默认布局' }), 'column');
  await click(user, 'Agent');
  assert.equal(command().value, '/draft-codex');
  await click(user, '外观'); await click(user, '保存');
  assert.deepEqual(saveSettings.mock.calls.map(call => call.arguments), [[{ theme: 'dark', defaultLayout: 'column' }]]);
  await click(user, 'Agent');
  assert.equal(command().value, '/draft-codex');
  await click(user, '放弃更改');
  assert.equal(command().value, 'codex');
  await click(user, '外观'); await click(user, '恢复默认设置');
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: '跟随系统' }).checked, true);
  await click(user, '放弃更改');
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: '深色' }).checked, true);
  assert.equal(saveSettings.mock.callCount(), 1);
});

test('save and leave submits all changed categories together and allows leaving only after success', async () => {
  const saved = defaultSettings(), pending = deferred<SettingsSaveResult>();
  const saveSettings = mock.fn((_patch: Partial<Settings>) => pending.promise);
  provideWorkbench({ saveSettings });
  const { user, ref } = renderSettings(saved);
  await user.clear(command()); await user.type(command(), '/new-codex');
  await click(user, '外观'); await user.click(screen.getByRole('radio', { name: '深色' }));
  await click(user, '快捷键');
  const binding = screen.getByRole('textbox', { name: '切换到下一个面板' });
  fireEvent.keyDown(binding, { key: 'k', code: 'KeyK', metaKey: true });
  let leave!: Promise<boolean>;
  act(() => { leave = ref.current!.requestLeave(); });
  assert.match(screen.getByRole('dialog').textContent!, /Agent、外观、快捷键/);
  await click(user, '保存并返回');
  const patch = { agents: { ...saved.agents, codex: { command: '/new-codex', args: [] } }, theme: 'dark' as const,
    defaultLayout: 'auto' as const, shortcuts: { ...saved.shortcuts, nextPanel: 'Command+K' } };
  assert.deepEqual(saveSettings.mock.calls.map(call => call.arguments), [[patch]]);
  assert.equal(await ref.current!.requestLeave(), false);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: '‹ 返回' }).disabled, true);
  await act(async () => pending.resolve({ ok: true, settings: { ...saved, ...patch } }));
  assert.equal(await leave, true);
  assert.equal(await ref.current!.requestLeave(), true);
});

test('validation failure reveals field errors, retains every draft and blocks leaving until corrected', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (_patch: Partial<Settings>): Promise<SettingsSaveResult> => ({ ok: false, kind: 'validation', issues: [
    { category: 'agents', field: 'agents.codex.command', code: 'required', message: '启动命令不能为空' },
  ] }));
  provideWorkbench({ saveSettings });
  const { user, ref, report } = renderSettings(saved);
  await user.clear(command());
  await click(user, '外观'); await user.click(screen.getByRole('radio', { name: '深色' }));
  let leave!: Promise<boolean>;
  act(() => { leave = ref.current!.requestLeave(); });
  await click(user, '保存并返回');
  assert.equal(await leave, false);
  assert.equal(command().value, '');
  assert.equal(command().getAttribute('aria-invalid'), 'true');
  assert.ok(screen.getByText('存在需修正的设置，未保存'));
  assert.deepEqual(report.mock.calls[0].arguments, ['存在需修正的设置，未保存']);
  await click(user, '外观');
  assert.equal(screen.getByRole<HTMLInputElement>('radio', { name: '深色' }).checked, true);
  await click(user, 'Agent'); await user.type(command(), '/fixed');
  assert.notEqual(command().getAttribute('aria-invalid'), 'true');
});

test('storage and unavailable failures keep drafts and block leaving, then allow a successful retry', async () => {
  for (const kind of ['storage', 'unavailable'] as const) {
    const saved = defaultSettings();
    provideWorkbench({ saveSettings: async () => ({ ok: false, kind, message: '保存失败，请重试' }) });
    const { user, ref, report } = renderSettings(saved);
    await user.clear(command()); await user.type(command(), '/preserved');
    let leave!: Promise<boolean>;
    act(() => { leave = ref.current!.requestLeave(); });
    await click(user, '保存并返回');
    assert.equal(await leave, false);
    assert.equal(command().value, '/preserved');
    assert.ok(screen.getByRole('alert'));
    assert.deepEqual(report.mock.calls.map(call => call.arguments), [['保存失败，请重试']]);
    const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({ ok: true as const, settings: { ...saved, ...patch } }));
    provideWorkbench({ saveSettings });
    act(() => { leave = ref.current!.requestLeave(); });
    await click(user, '保存并返回');
    assert.equal(await leave, true);
    assert.deepEqual(saveSettings.mock.calls[0].arguments, [{ agents: { ...saved.agents, codex: { command: '/preserved', args: [] } } }]);
    cleanup();
  }
});

test('a pending ordinary save blocks repeated submissions and draft mutation', async () => {
  const saved = defaultSettings(), pending = deferred<SettingsSaveResult>();
  const saveSettings = mock.fn((_patch: Partial<Settings>) => pending.promise);
  provideWorkbench({ saveSettings });
  const { user, ref } = renderSettings(saved);
  await user.type(command(), '-edited');
  act(() => { fireEvent.submit(command().closest('form')!); fireEvent.submit(command().closest('form')!); });
  await click(user, '保存'); await click(user, '外观'); await click(user, '放弃更改');
  await user.type(command(), '-late');
  assert.equal(command().value, 'codex-edited');
  assert.equal(saveSettings.mock.callCount(), 1);
  assert.equal(await ref.current!.requestLeave(), false);
  await act(async () => pending.resolve({ ok: true, settings: { ...saved, agents: { ...saved.agents, codex: { command: 'codex-edited', args: [] } } } }));
  assert.equal(await ref.current!.requestLeave(), true);
});

test('cancel keeps a draft, discard allows leaving without saving, and unmount cancels a pending leave decision', async () => {
  provideWorkbench({});
  const { user, ref } = renderSettings();
  assert.equal(await ref.current!.requestLeave(), true);
  await user.type(command(), '-draft');
  let leave!: Promise<boolean>;
  act(() => { leave = ref.current!.requestLeave(); });
  assert.equal(await ref.current!.requestLeave(), false);
  await click(user, '取消'); assert.equal(await leave, false);
  assert.equal(command().value, 'codex-draft');
  act(() => { leave = ref.current!.requestLeave(); });
  await click(user, '不保存'); assert.equal(await leave, true);
  act(() => { leave = ref.current!.requestLeave(); });
  cleanup(); assert.equal(await leave, false);
});

test('late command checks cannot replace feedback for a newer or discarded draft', async () => {
  const old = deferred<CommandCheck>();
  const checkCommand = mock.fn((value: string) => value === 'codex' ? old.promise : Promise.resolve({ available: true as const, path: '/new-command' }));
  provideWorkbench({ checkCommand });
  const { user } = renderSettings();
  assert.equal(checkCommand.mock.callCount(), 0);
  await user.click(screen.getAllByRole('button', { name: '检查命令' })[0]);
  await user.clear(command()); await user.type(command(), 'new');
  await user.click(screen.getAllByRole('button', { name: '检查命令' })[0]);
  assert.ok(screen.getByText('命令可用：/new-command'));
  await act(async () => old.resolve({ available: false, message: 'stale result' }));
  assert.equal(screen.queryByText('stale result'), null);
  assert.ok(screen.getByText('命令可用：/new-command'));
  const discarded = deferred<CommandCheck>();
  provideWorkbench({ checkCommand: () => discarded.promise });
  await user.click(screen.getAllByRole('button', { name: '检查命令' })[0]);
  await click(user, '放弃更改');
  await act(async () => discarded.resolve({ available: true, path: '/discarded-command' }));
  assert.equal(command().value, 'codex');
  assert.equal(screen.queryByText('命令可用：/discarded-command'), null);
});
