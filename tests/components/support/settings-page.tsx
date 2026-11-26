import { createRef } from 'react';
import { mock } from 'node:test';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../../app/renderer/settings/SettingsPage';
import { defaultSettings } from '../../../app/shared/settings/settings';
import { t } from './localization';

export function renderSettings(settings = defaultSettings()) {
  const ref = createRef<SettingsPageActions>();
  const report = mock.fn();
  render(
    <SettingsPage
      initialCategory="agents"
      settings={settings}
      startupTheme={settings.theme}
      ref={ref}
      back={() => {}}
      report={report}
    />,
  );
  return { user: userEvent.setup(), ref, report };
}
export const click = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('button', { name }));
export const command = () => screen.getAllByRole<HTMLInputElement>('textbox', { name: t('launchCommand') })[0];
export const startsWith = (prefix: string) => (name: string) => name.startsWith(prefix);
