import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PanelTray } from '../../app/renderer/PanelTray';
import { Localization } from '../../app/renderer/Localization';
import type { PanelView } from '../../app/shared/model';

afterEach(cleanup);

const panels: PanelView[] = [
  { id: 'titled', agent: 'claude', run: { id: 'run-titled', panelId: 'titled', projectId: 'project', state: 'running', title: 'Review the parser' }, status: 'needs-input' },
  { id: 'untitled', agent: 'pi', run: { id: 'run-untitled', panelId: 'untitled', projectId: 'project', state: 'running' }, status: 'busy' },
];

function renderTray(language: 'en' | 'zh-CN', openPanelId?: string) {
  const calls: string[] = [];
  const view = (open?: string) => <Localization language={language}>
    <PanelTray panels={panels} openPanelId={open} open={id => calls.push(`open:${id}`)} collapse={() => calls.push('collapse')} />
  </Localization>;
  const result = render(view(openPanelId));
  return { calls, rerender: (open?: string) => result.rerender(view(open)), user: userEvent.setup() };
}

test('tray cards show each panel\'s Agent type, session title or placeholder and processing state, in tray order, with no add entry', () => {
  renderTray('en');
  const tray = screen.getByRole('region', { name: 'Ephemeral panel tray' });
  const cards = within(tray).getAllByRole('button');
  assert.deepEqual(cards.map(card => card.dataset.hint), ['Claude Code · Review the parser', 'pi · Untitled task']);
  assert.ok(cards[0].classList.contains('claude')); assert.ok(cards[1].classList.contains('pi'));
  assert.deepEqual(cards.map(card => within(card).getByRole('img').getAttribute('aria-label')), ['Needs input', 'Busy']);
  assert.deepEqual(cards.map(card => card.querySelector('.session-title')?.textContent), ['Review the parser', 'Untitled task']);
  assert.equal(within(tray).queryByRole('button', { name: /Add Agent|＋/ }), null);
});

test('clicking a collapsed card opens it, and clicking the open card collapses it', async () => {
  const { calls, rerender, user } = renderTray('zh-CN');
  const tray = screen.getByRole('region', { name: '临时面板托盘' });
  const [titled, untitled] = within(tray).getAllByRole('button');
  assert.equal(untitled.dataset.hint, 'pi · 未命名任务');
  assert.deepEqual([titled, untitled].map(card => card.getAttribute('aria-pressed')), ['false', 'false']);
  await user.click(untitled);
  assert.deepEqual(calls, ['open:untitled']);
  rerender('untitled');
  assert.deepEqual([titled, untitled].map(card => card.getAttribute('aria-pressed')), ['false', 'true']);
  await user.click(titled);
  await user.click(untitled);
  assert.deepEqual(calls, ['open:untitled', 'open:titled', 'collapse']);
});
