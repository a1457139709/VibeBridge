import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { canFly } from '../app/renderer/workspace/tray-flight';

/** A panel that can animate, as an element in a browser can. */
const animatable = { animate() {} } as unknown as Element;

function prefersReducedMotion(reduced: boolean) {
  Object.assign(globalThis, {
    matchMedia: (query: string) => ({ matches: reduced && query === '(prefers-reduced-motion: reduce)' }),
  });
}
afterEach(() => {
  delete (globalThis as { matchMedia?: unknown }).matchMedia;
});

test('a tray panel flies between its card and the layout area while motion is not reduced', () => {
  prefersReducedMotion(false);
  assert.equal(canFly(animatable), true);
});

test('with reduced motion a tray panel does not fly: it opens and collapses at once, and its card does not flash', () => {
  prefersReducedMotion(true);
  assert.equal(canFly(animatable), false);
});

test('a tray panel without a slot does not fly', () => {
  prefersReducedMotion(false);
  assert.equal(canFly(undefined), false);
  assert.equal(canFly(null), false);
});
