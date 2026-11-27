import test from 'node:test';
import assert from 'node:assert/strict';
import { playToEnd } from '../app/renderer/common/animation-outcome';

const ending = (finished: Promise<unknown>) => ({ finished });

test('an animation that runs to its end has finished', async () => {
  assert.equal(await playToEnd(ending(Promise.resolve())), 'finished');
});

test('an animation cancelled before its end is cancelled', async () => {
  assert.equal(await playToEnd(ending(Promise.reject(new DOMException('cancelled', 'AbortError')))), 'cancelled');
});

test('any other failure while the animation plays is thrown', async () => {
  const failure = new TypeError('keyframes are invalid');
  await assert.rejects(playToEnd(ending(Promise.reject(failure))), error => error === failure);
});
