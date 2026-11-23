import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { HoverHints } from '../../app/renderer/common/HoverHints';

afterEach(cleanup);

const cardHint = 'Claude Code · Review the parser',
  statusHint = 'Busy',
  plainName = 'Plain';

function renderHinted() {
  render(
    <>
      <button data-hint={cardHint}>
        Card
        <span role="img" aria-label={statusHint} data-hint={statusHint}>
          ◌
        </span>
      </button>
      <button>{plainName}</button>
      <HoverHints />
    </>,
  );
  return userEvent.setup();
}

const card = () => screen.getAllByRole('button')[0];

test('hovering an element with a hint shows the hint, and leaving it hides the hint', async () => {
  const user = renderHinted();
  await user.hover(card());
  assert.equal((await screen.findByRole('tooltip')).textContent, cardHint);
  await user.unhover(card());
  await user.hover(screen.getByRole('button', { name: plainName }));
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
});

test('a hint inside a hinted element replaces the outer hint while the pointer is over it', async () => {
  const user = renderHinted();
  await user.hover(screen.getByRole('img', { name: statusHint }));
  await waitFor(() =>
    assert.deepEqual(
      screen.getAllByRole('tooltip').map(hint => hint.textContent),
      [statusHint],
    ),
  );
});

test("keyboard focus shows the focused element's hint, and pressing the element hides it", async () => {
  const user = renderHinted();
  await user.tab();
  assert.equal((await screen.findByRole('tooltip')).textContent, cardHint);
  await user.keyboard('{Tab}');
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
  await user.hover(card());
  await screen.findByRole('tooltip');
  await user.pointer({ keys: '[MouseLeft>]', target: card() });
  await waitFor(() => assert.equal(screen.queryByRole('tooltip'), null));
});

test("the keyboard-focused element's hint returns after the pointer passes over another hinted element", async () => {
  const focusedHint = 'Focused hint',
    passingHint = 'Passing hint';
  render(
    <>
      <button data-hint={focusedHint}>Focused</button>
      <button data-hint={passingHint}>Passing</button>
      <p>Elsewhere</p>
      <HoverHints />
    </>,
  );
  const user = userEvent.setup();
  await user.tab();
  assert.equal((await screen.findByRole('tooltip')).textContent, focusedHint);
  const [, passing] = screen.getAllByRole('button');
  await user.hover(passing);
  await waitFor(() => assert.equal(screen.getByRole('tooltip').textContent, passingHint));
  await user.hover(screen.getByRole('paragraph'));
  await waitFor(() => assert.equal(screen.getByRole('tooltip').textContent, focusedHint));
});
