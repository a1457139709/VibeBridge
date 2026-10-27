import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Localization } from '../../app/renderer/Localization';
import { DefaultShortcutConflictDialog } from '../../app/renderer/DefaultShortcutConflict';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

test('the startup default shortcut conflict dialog cannot be dismissed and offers only shortcut settings or quitting', async () => {
  const quit = mock.fn(async () => {});
  provideWorkbench({ quit });
  const openShortcuts = mock.fn();
  render(<Localization language="en"><DefaultShortcutConflictDialog openShortcuts={openShortcuts} /></Localization>);
  const user = userEvent.setup();
  const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Shortcut conflict' });
  assert.equal(dialog.open, true);
  assert.equal(fireEvent(dialog, new Event('cancel', { cancelable: true })), false);
  act(() => { dialog.close(); fireEvent(dialog, new Event('close')); });
  assert.equal(dialog.open, true);
  assert.deepEqual(screen.getAllByRole('button').map(button => button.textContent), ['Quit app', 'Open shortcut settings']);
  await user.click(screen.getByRole('button', { name: 'Quit app' }));
  assert.equal(quit.mock.callCount(), 1);
  assert.equal(openShortcuts.mock.callCount(), 0);
  await user.click(screen.getByRole('button', { name: 'Open shortcut settings' }));
  assert.equal(openShortcuts.mock.callCount(), 1);
});
