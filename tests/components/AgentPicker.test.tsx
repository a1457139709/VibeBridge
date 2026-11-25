import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { AgentPicker } from '../../app/renderer/workspace/AgentPicker';
import { Localization } from '../../app/renderer/common/Localization';
import { message } from '../../app/shared/messages';
import { agentNames } from '../../app/shared/model';
import { localize } from '../../app/shared/localization/localization';
import { t } from './support/localization';
import type { PanelCreation } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const failed: PanelCreation = {
  panel: { id: 'panel', agent: 'pi' },
  launch: {
    outcome: 'failed',
    run: { id: 'run', panelId: 'panel', projectId: 'project', state: 'failed' },
    agent: 'pi',
  },
};

const pi = { name: (name: string) => name.endsWith(agentNames.pi) };
const hostReason = 'host timeout',
  thrown = 'Panel limit';

function renderPicker(language: 'en' | 'zh-CN' = 'en') {
  const close = mock.fn(),
    onPanelAdded = mock.fn(),
    openAgentSettings = mock.fn();
  render(
    <Localization language={language}>
      <AgentPicker projectId="project" atPanelLimit={false} {...{ close, onPanelAdded, openAgentSettings }} />
    </Localization>,
  );
  return { user: userEvent.setup(), close, onPanelAdded, openAgentSettings };
}

test('a failed launch keeps the picker open with feedback that leads to Agent settings', async () => {
  provideWorkbench({ addPanel: async () => failed });
  const { user, close, onPanelAdded, openAgentSettings } = renderPicker();
  await user.click(screen.getByRole('button', pi));
  assert.equal(screen.getByRole('alert').textContent, t('launchFailed'));
  assert.equal(onPanelAdded.mock.callCount(), 0);
  await user.click(screen.getByRole('button', { name: t('openAgentSettings') }));
  assert.equal(close.mock.callCount(), 1);
  assert.equal(openAgentSettings.mock.callCount(), 1);
});

test('the launch failure and its settings entry are localized', async () => {
  provideWorkbench({ addPanel: async () => failed });
  const { user } = renderPicker('zh-CN');
  await user.click(screen.getByRole('button', pi));
  const zh = localize('zh-CN');
  assert.equal(screen.getByRole('alert').textContent, zh.t('launchFailed'));
  assert.ok(screen.getByRole('button', { name: zh.t('openAgentSettings') }));
});

test('an error that is not a launch failure offers no settings entry', async () => {
  provideWorkbench({
    addPanel: async () => {
      throw new Error(thrown);
    },
  });
  const { user } = renderPicker();
  await user.click(screen.getByRole('button', pi));
  assert.equal(screen.getByRole('alert').textContent, thrown);
  assert.equal(screen.queryByRole('button', { name: t('openAgentSettings') }), null);
});

test('an unconfirmed launch reports its reason without suggesting the Agent settings are wrong', async () => {
  provideWorkbench({
    addPanel: async () => ({
      panel: { id: 'panel', agent: 'pi' },
      launch: {
        outcome: 'unconfirmed',
        agent: 'pi',
        run: { id: 'run', panelId: 'panel', projectId: 'project', state: 'starting' },
        reason: message('launchUnconfirmed', { reason: hostReason }),
      },
    }),
  });
  const { user, onPanelAdded } = renderPicker();
  await user.click(screen.getByRole('button', pi));
  assert.equal(screen.getByRole('alert').textContent, t('launchUnconfirmed', { reason: hostReason }));
  assert.equal(screen.queryByRole('button', { name: t('openAgentSettings') }), null);
  assert.equal(onPanelAdded.mock.callCount(), 0);
});
