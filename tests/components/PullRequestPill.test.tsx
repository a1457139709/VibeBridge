import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import type { PullRequestState } from '../../app/shared/forge/forge';
import { PullRequestPill } from '../../app/renderer/forge/ForgeDisplay';
import { selectElement } from './support/elements';

afterEach(cleanup);

const stateColors: [PullRequestState, string][] = [
  ['open', 'var(--forge-open)'],
  ['draft', 'var(--forge-skipped)'],
  ['merged', 'var(--forge-done)'],
  ['closed', 'var(--forge-failed)'],
];

for (const [state, color] of stateColors) {
  test(`a ${state} pull request's state pill is filled with its state color`, () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('app/renderer/forge/forge-sidebar.css', 'utf8');
    document.head.append(style);
    try {
      const { container } = render(<PullRequestPill state={state} />);
      const pill = selectElement('.forge-pill', container);
      const backgrounds = [...(style.sheet?.cssRules ?? [])]
        .flatMap(rule =>
          rule instanceof window.CSSStyleRule && pill.matches(rule.selectorText)
            ? [rule.style.getPropertyValue('background')]
            : [],
        )
        .filter(Boolean);
      assert.deepEqual(backgrounds, [color]);
    } finally {
      style.remove();
    }
  });
}
