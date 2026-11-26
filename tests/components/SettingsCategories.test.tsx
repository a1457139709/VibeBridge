import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { Settings } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';
import { requireInstance, selectElement } from './support/elements';
import { t } from './support/localization';
import { click, renderSettings, startsWith } from './support/settings-page';

afterEach(cleanup);

test('switching category shows the new category from the top', async () => {
  provideWorkbench({});
  const { user } = renderSettings();
  selectElement('.settings-scroll').scrollTop = 120;
  await click(user, t('shortcuts'));
  assert.equal(selectElement('.settings-scroll').scrollTop, 0);
});

test('Keyboard shortcuts lists toggling the forge sidebar at Command+Alt+B, and a new binding for it is saved', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({
    ok: true as const,
    settings: { ...saved, ...patch },
  }));
  provideWorkbench({ saveSettings });
  const { user } = renderSettings(saved);
  await click(user, t('shortcuts'));
  const binding = screen.getByRole<HTMLInputElement>('textbox', { name: t('toggleForgeSidebar') });
  assert.equal(binding.value, '⌘ ⌥ B');
  fireEvent.keyDown(binding, { key: 'g', code: 'KeyG', metaKey: true, altKey: true });
  await click(user, t('save'));
  assert.equal(saveSettings.mock.calls[0].arguments[0].shortcuts?.toggleForgeSidebar, 'Command+Alt+G');
});

test('Keyboard shortcuts lists opening the dispatch menu at Command+D and locating the dispatched panel at Command+L, with conflict checks', async () => {
  const saved = defaultSettings();
  provideWorkbench({});
  const { user } = renderSettings(saved);
  await click(user, t('shortcuts'));
  const openDispatchMenu = screen.getByRole<HTMLInputElement>('textbox', { name: t('openDispatchMenu') });
  assert.equal(openDispatchMenu.value, '⌘ D');
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('locateDispatchedPanel') }).value, '⌘ L');
  fireEvent.keyDown(openDispatchMenu, { key: 'l', code: 'KeyL', metaKey: true });
  assert.ok(
    screen.getByRole('textbox', {
      name: t('openDispatchMenu'),
      description: t('shortcutConflict', { actions: [t('locateDispatchedPanel')] }),
    }),
  );
});

test('Workflows sits between Agent and Appearance, and saves the workflow switch and each command delivery', async () => {
  const saved = defaultSettings();
  const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({
    ok: true as const,
    settings: { ...saved, ...patch },
  }));
  provideWorkbench({ saveSettings });
  const { user } = renderSettings(saved);
  const categories = within(screen.getByRole('navigation', { name: t('settingsCategories') })).getAllByRole('button');
  assert.deepEqual(
    categories.map(button => button.textContent),
    [t('general'), t('agents'), t('workflows'), t('appearance'), t('shortcuts')],
  );
  await click(user, t('workflows'));
  assert.equal(screen.queryByRole('checkbox'), null, 'the workflow switch is not a checkbox');
  const enabled = screen.getByRole('switch', { name: t('workflowMatt') });
  assert.equal(enabled.getAttribute('aria-checked'), 'true', "Matt's workflow is on by default");
  const commands = screen.getAllByRole('radiogroup').map(group => group.getAttribute('aria-label'));
  assert.deepEqual(commands, [
    'grill-with-docs {url}',
    'to-spec {url}',
    'to-tickets {url}',
    'implement {url}',
    'implement-spec {url}',
    'wayfinder {url}',
    'triage look at {url}',
    'diagnosing-bugs {url}',
    'tdd {url}',
    'prototype {url}',
    'research {url}',
    'grill-me {url}',
  ]);
  assert.ok(
    screen
      .getAllByRole('radio', { name: t('deliverySubmit') })
      .every(radio => requireInstance(radio, HTMLInputElement).checked),
    'every command submits by default',
  );
  assert.equal(screen.queryByRole('textbox'), null, 'commands cannot be added or edited');
  await user.click(
    within(screen.getByRole('radiogroup', { name: startsWith('tdd ') })).getByRole('radio', {
      name: t('deliveryFill'),
    }),
  );
  await user.click(enabled);
  assert.equal(enabled.getAttribute('aria-checked'), 'false', 'clicking the switch turns the workflow off');
  await user.click(screen.getByRole('button', { name: t('showWorkflowCommands', { workflow: t('workflowMatt') }) }));
  assert.equal(screen.queryAllByRole('radiogroup').length, 0, 'collapsing hides the commands');
  await click(user, t('save'));
  assert.deepEqual(
    saveSettings.mock.calls.map(call => call.arguments),
    [
      [
        {
          workflows: {
            matt: { enabled: false, commands: { ...saved.workflows.matt.commands, tdd: { delivery: 'fill' } } },
          },
        },
      ],
    ],
  );
});
