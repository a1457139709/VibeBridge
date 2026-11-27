import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PanelTray } from '../../app/renderer/workspace/PanelTray';
import { Localization } from '../../app/renderer/common/Localization';
import { agentNames, type PanelView } from '../../app/shared/model';
import { localize } from '../../app/shared/localization/localization';
import { t } from './support/localization';

afterEach(cleanup);

const zh = localize('zh-CN').t;
const parserTitle = 'Review the parser';

const panels: PanelView[] = [
  {
    id: 'titled',
    agent: 'claude',
    run: { id: 'run-titled', panelId: 'titled', projectId: 'project', state: 'running', title: parserTitle },
    status: 'needs-input',
  },
  {
    id: 'untitled',
    agent: 'pi',
    run: { id: 'run-untitled', panelId: 'untitled', projectId: 'project', state: 'running' },
    status: 'busy',
  },
];

function renderTray(language: 'en' | 'zh-CN', openPanelId?: string) {
  const calls: string[] = [];
  const view = (open?: string) => (
    <Localization language={language}>
      <PanelTray
        panels={panels}
        openPanelId={open}
        landedPanelId={undefined}
        open={id => calls.push(`open:${id}`)}
        collapse={() => calls.push('collapse')}
      />
    </Localization>
  );
  const result = render(view(openPanelId));
  return { calls, rerender: (open?: string) => result.rerender(view(open)), user: userEvent.setup() };
}

test("tray cards show each panel's Agent type, session title or placeholder and processing state, in tray order, with no add entry", () => {
  renderTray('en');
  const tray = screen.getByRole('region', { name: t('panelTray') });
  const cards = within(tray).getAllByRole('button');
  assert.equal(cards.length, panels.length, 'the tray holds only panel cards');
  assert.deepEqual(
    cards.map(card => card.dataset.hint),
    [
      t('agentPanelTitle', { agent: agentNames.claude, title: parserTitle }),
      t('agentPanelTitle', { agent: agentNames.pi, title: t('untitled') }),
    ],
  );
  assert.ok(cards[0].classList.contains('claude'));
  assert.ok(cards[1].classList.contains('pi'));
  assert.deepEqual(
    cards.map(card => within(card).getByRole('img').getAttribute('aria-label')),
    [t('needs-input'), t('busy')],
  );
  assert.deepEqual(
    cards.map(card => card.querySelector('.session-title')?.textContent),
    [parserTitle, t('untitled')],
  );
});

test('clicking a collapsed card opens it, and clicking the open card collapses it', async () => {
  const { calls, rerender, user } = renderTray('zh-CN');
  const tray = screen.getByRole('region', { name: zh('panelTray') });
  const [titled, untitled] = within(tray).getAllByRole('button');
  assert.equal(untitled.dataset.hint, zh('agentPanelTitle', { agent: agentNames.pi, title: zh('untitled') }));
  assert.deepEqual(
    [titled, untitled].map(card => card.getAttribute('aria-pressed')),
    ['false', 'false'],
  );
  await user.click(untitled);
  assert.deepEqual(calls, ['open:untitled']);
  rerender('untitled');
  assert.deepEqual(
    [titled, untitled].map(card => card.getAttribute('aria-pressed')),
    ['false', 'true'],
  );
  await user.click(titled);
  await user.click(untitled);
  assert.deepEqual(calls, ['open:untitled', 'open:titled', 'collapse']);
});
