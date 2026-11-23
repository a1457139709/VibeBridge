import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { defaultSettings } from '../../app/shared/settings/settings';
import { newDraft } from '../../app/shared/model';
import { message } from '../../app/shared/messages';
import { Localization } from '../../app/renderer/common/Localization';
import { Notices, useNotices } from '../../app/renderer/common/Notices';
import { SettingsPage } from '../../app/renderer/settings/SettingsPage';
import { Setup } from '../../app/renderer/projects/Setup';
import { provideWorkbench } from './support/workbench';
import { localize } from '../../app/shared/localization/localization';
import { t } from './support/localization';
import { selectElement } from './support/elements';

const zh = localize('zh-CN').t;
const notices = () => within(selectElement('.notices'));

afterEach(cleanup);

test('switching language preserves project input and old notice identity and expiry while the save notice uses the new language', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  function Harness() {
    const [settings, setSettings] = useState(defaultSettings);
    const [draft, setDraft] = useState(newDraft);
    const { notices, report, dismiss } = useNotices();
    provideWorkbench({
      chooseDirectory: async () => {
        throw new Error(message('environmentFailed'));
      },
      saveSettings: async patch => {
        const next = { ...settings, ...patch };
        setSettings(next);
        return { ok: true, settings: next };
      },
    });
    return (
      <Localization language={settings.language}>
        <Setup
          draft={draft}
          changeDraft={setDraft}
          defaultLayout="auto"
          cancel={() => {}}
          onSetupFinished={() => {}}
          openProject={() => {}}
          report={report}
          openAgentSettings={() => {}}
        />
        <SettingsPage settings={settings} startupTheme="system" ref={null} back={() => {}} report={report} />
        <Notices notices={notices} dismiss={dismiss} />
      </Localization>
    );
  }
  render(<Harness />);
  const input = screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') });
  fireEvent.change(input, { target: { value: 'Untitled task 原样' } });
  fireEvent.paste(input, { clipboardData: { getData: () => 'line\nbreak' } });
  assert.ok(screen.getByRole('textbox', { name: t('projectName'), description: t('nameControls') }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('chooseDirectory') }));
  });
  const notice = notices().getByRole('alert');
  assert.equal(notice.textContent?.includes(t('environmentFailed')), true);
  act(() => context.mock.timers.tick(4000));
  fireEvent.change(screen.getByRole('combobox', { name: t('language') }), { target: { value: 'zh-CN' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t('save') }));
  });
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: zh('projectName') }), input);
  assert.equal(input.value, 'Untitled task 原样');
  assert.ok(screen.getByRole('textbox', { name: zh('projectName'), description: zh('nameControls') }));
  assert.equal(notices().getByRole('alert'), notice);
  assert.equal(notice.textContent?.includes(zh('environmentFailed')), true);
  const saved = notices().getByRole('status');
  assert.equal(saved.textContent?.includes(zh('settingsSaved')), true);
  act(() => context.mock.timers.tick(999));
  assert.equal(notices().getByRole('alert'), notice);
  act(() => context.mock.timers.tick(1));
  assert.equal(notices().queryByRole('alert'), null);
  assert.equal(notices().getByRole('status'), saved);
  act(() => context.mock.timers.tick(1000));
  assert.equal(notices().queryByRole('status'), null);
});
