import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AgentPicker } from '../../app/renderer/AgentPicker';
import { Localization } from '../../app/renderer/Localization';
import { message } from '../../app/shared/messages';
import type { PanelCreation } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const failed: PanelCreation = { panel: { id: 'panel', agent: 'pi' },
  launch: { outcome: 'failed', run: { id: 'run', panelId: 'panel', projectId: 'project', state: 'failed' }, agent: 'pi' } };

function renderPicker(language: 'en' | 'zh-CN' = 'en') {
  const close = mock.fn(), added = mock.fn(), openAgentSettings = mock.fn();
  render(<Localization language={language}><AgentPicker projectId="project" full={false} {...{ close, added, openAgentSettings }} /></Localization>);
  return { user: userEvent.setup(), close, added, openAgentSettings };
}

test('a failed launch keeps the picker open with feedback that leads to Agent settings', async () => {
  provideWorkbench({ addPanel: async () => failed });
  const { user, close, added, openAgentSettings } = renderPicker();
  await user.click(screen.getByRole('button', { name: /pi$/ }));
  assert.equal(screen.getByRole('alert').textContent, 'Agent could not start');
  assert.equal(added.mock.callCount(), 0);
  await user.click(screen.getByRole('button', { name: 'Open Agent settings' }));
  assert.equal(close.mock.callCount(), 1);
  assert.equal(openAgentSettings.mock.callCount(), 1);
});

test('the launch failure and its settings entry are localized', async () => {
  provideWorkbench({ addPanel: async () => failed });
  const { user } = renderPicker('zh-CN');
  await user.click(screen.getByRole('button', { name: /pi$/ }));
  assert.equal(screen.getByRole('alert').textContent, 'Agent 无法启动');
  assert.ok(screen.getByRole('button', { name: '打开 Agent 设置' }));
});

test('an error that is not a launch failure offers no settings entry', async () => {
  provideWorkbench({ addPanel: async () => { throw new Error('Panel limit'); } });
  const { user } = renderPicker();
  await user.click(screen.getByRole('button', { name: /pi$/ }));
  assert.equal(screen.getByRole('alert').textContent, 'Panel limit');
  assert.equal(screen.queryByRole('button', { name: 'Open Agent settings' }), null);
});

test('an unconfirmed launch reports its reason without suggesting the Agent settings are wrong', async () => {
  provideWorkbench({ addPanel: async () => ({ panel: { id: 'panel', agent: 'pi' }, launch: { outcome: 'unconfirmed', agent: 'pi',
    run: { id: 'run', panelId: 'panel', projectId: 'project', state: 'starting' }, reason: message('launchUnconfirmed', { reason: 'host timeout' }) } }) });
  const { user, added } = renderPicker();
  await user.click(screen.getByRole('button', { name: /pi$/ }));
  assert.equal(screen.getByRole('alert').textContent, 'Launch could not be confirmed: host timeout');
  assert.equal(screen.queryByRole('button', { name: 'Open Agent settings' }), null);
  assert.equal(added.mock.callCount(), 0);
});
