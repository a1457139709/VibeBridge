import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { createRef } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { SettingsPage, type SettingsPageActions } from '../../app/renderer/SettingsPage';
import { defaultSettings } from '../../app/shared/settings';
import type { Settings } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const instructionNames = ['grill-with-docs {url}', 'to-spec {url}', 'to-tickets {url}', 'implement {url}', 'implement-spec {url}', 'wayfinder {url}',
  'triage look at {url}', 'diagnosing-bugs {url}', 'tdd {url}', 'prototype {url}', 'research {url}', 'grill-me {url}'];

function renderWorkflows(settings: Settings) {
  render(<SettingsPage initialCategory="workflows" settings={settings} startupTheme={settings.theme} ref={createRef<SettingsPageActions>()} back={() => {}} report={() => {}} />);
  return userEvent.setup();
}

test('the Workflows category sits between Agent and Appearance', () => {
  renderWorkflows(defaultSettings());
  const navigation = screen.getByRole('navigation', { name: 'Settings categories' });
  assert.deepEqual(within(navigation).getAllByRole('button').map(button => button.textContent),
    ['General', 'Agent', 'Workflows', 'Appearance', 'Keyboard shortcuts']);
});

test('each workflow is one switch that expands to its fixed instructions, each choosing Submit or Fill only', async () => {
  const user = renderWorkflows(defaultSettings());
  assert.equal(screen.getByRole<HTMLInputElement>('switch', { name: 'mattpocock/skills' }).checked, true);
  const expand = screen.getByRole('button', { name: 'mattpocock/skills instructions' });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('radiogroup'), null);
  await user.click(expand);
  assert.equal(expand.getAttribute('aria-expanded'), 'true');
  const list = screen.getByRole('list', { name: 'mattpocock/skills instructions' });
  const items = within(list).getAllByRole('listitem');
  assert.deepEqual(items.map(item => within(item).getByRole('radiogroup').getAttribute('aria-label')), instructionNames);
  for (const item of items) {
    assert.equal(within(item).getByRole<HTMLInputElement>('radio', { name: 'Submit' }).checked, true);
    assert.equal(within(item).getByRole<HTMLInputElement>('radio', { name: 'Fill only' }).checked, false);
  }
  assert.deepEqual(items.map(item => item.classList.contains('separated')), instructionNames.map(name => name === 'diagnosing-bugs {url}'));
  assert.equal(within(list).queryByRole('textbox'), null);
  assert.equal(within(list).queryByRole('button'), null);
});

test('switching a workflow off and an instruction to Fill only saves the workflows with unknown entries kept', async () => {
  const saved = defaultSettings();
  saved.workflows = { ...saved.workflows, pstack: { enabled: true, instructions: { 'poteto-mode': { delivery: 'fill' } } } };
  const saveSettings = mock.fn(async (patch: Partial<Settings>) => ({ ok: true as const, settings: { ...saved, ...patch } }));
  provideWorkbench({ saveSettings });
  const user = renderWorkflows(saved);
  await user.click(screen.getByRole('switch', { name: 'mattpocock/skills' }));
  await user.click(screen.getByRole('button', { name: 'mattpocock/skills instructions' }));
  await user.click(within(screen.getByRole('radiogroup', { name: 'tdd {url}' })).getByRole('radio', { name: 'Fill only' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  assert.deepEqual(saveSettings.mock.calls.map(call => call.arguments), [[{ workflows: {
    matt: { enabled: false, instructions: { ...saved.workflows.matt.instructions, tdd: { delivery: 'fill' } } },
    pstack: { enabled: true, instructions: { 'poteto-mode': { delivery: 'fill' } } },
  } }]]);
});
