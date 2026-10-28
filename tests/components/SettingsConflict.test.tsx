import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Localization } from '../../app/renderer/Localization';
import { SettingsConflictDialog } from '../../app/renderer/SettingsConflict';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

test('the startup settings conflict dialog cannot be dismissed and offers only the conflicting settings or quitting', async () => {
  const quit = mock.fn(async () => {});
  provideWorkbench({ quit });
  const openSettings = mock.fn();
  render(<Localization language="en"><SettingsConflictDialog category="shortcuts" openSettings={openSettings} /></Localization>);
  const user = userEvent.setup();
  const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Settings conflict' });
  assert.equal(dialog.open, true);
  assert.match(dialog.textContent!, /Keyboard shortcuts settings/);
  assert.equal(fireEvent(dialog, new Event('cancel', { cancelable: true })), false);
  act(() => { dialog.close(); fireEvent(dialog, new Event('close')); });
  assert.equal(dialog.open, true);
  assert.deepEqual(screen.getAllByRole('button').map(button => button.textContent), ['Quit app', 'Fix in settings']);
  await user.click(screen.getByRole('button', { name: 'Quit app' }));
  assert.equal(quit.mock.callCount(), 1);
  assert.equal(openSettings.mock.callCount(), 0);
  await user.click(screen.getByRole('button', { name: 'Fix in settings' }));
  assert.equal(openSettings.mock.callCount(), 1);
});
