import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { HoverHints } from '../../app/renderer/HoverHints';

afterEach(cleanup);

function renderHinted() {
  render(<>
    <button data-hint="Claude Code · Review the parser">Card<span role="img" aria-label="Busy" data-hint="Busy">◌</span></button>
    <button>Plain</button>
    <HoverHints />
  </>);
  return userEvent.setup();
}

test('hovering an element with a hint shows the hint, and leaving it hides the hint', async () => {
  const user = renderHinted();
  await user.hover(screen.getByText('Card'));
  assert.equal((await screen.findByRole('tooltip')).textContent, 'Claude Code · Review the parser');
  await user.unhover(screen.getByText('Card'));
  await user.hover(screen.getByRole('button', { name: 'Plain' }));
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
});

test('a hint inside a hinted element replaces the outer hint while the pointer is over it', async () => {
  const user = renderHinted();
  await user.hover(screen.getByRole('img', { name: 'Busy' }));
  await waitFor(() => assert.deepEqual(screen.getAllByRole('tooltip').map(hint => hint.textContent), ['Busy']));
});

test('keyboard focus shows the focused element\'s hint, and pressing the element hides it', async () => {
  const user = renderHinted();
  await user.tab();
  assert.equal((await screen.findByRole('tooltip')).textContent, 'Claude Code · Review the parser');
  await user.keyboard('{Tab}');
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
  await user.hover(screen.getByText('Card'));
  await screen.findByRole('tooltip');
  await user.pointer({ keys: '[MouseLeft>]', target: screen.getByText('Card') });
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
});

test('the keyboard-focused element\'s hint returns after the pointer passes over another hinted element', async () => {
  render(<>
    <button data-hint="Focused hint">Focused</button>
    <button data-hint="Passing hint">Passing</button>
    <span>Elsewhere</span>
    <HoverHints />
  </>);
  const user = userEvent.setup();
  await user.tab();
  assert.equal((await screen.findByRole('tooltip')).textContent, 'Focused hint');
  await user.hover(screen.getByRole('button', { name: 'Passing' }));
  await waitFor(() => assert.equal(screen.getByRole('tooltip').textContent, 'Passing hint'));
  await user.hover(screen.getByText('Elsewhere'));
  await waitFor(() => assert.equal(screen.getByRole('tooltip').textContent, 'Focused hint'));
});
