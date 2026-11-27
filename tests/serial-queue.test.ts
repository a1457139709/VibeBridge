import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../app/main/serial-queue';

test('actions run one at a time, in the order they were queued', async () => {
  const queue = new SerialQueue();
  const events: string[] = [];
  let openGate!: () => void;
  const gate = new Promise<void>(resolve => (openGate = resolve));
  const first = queue.run(async () => {
    events.push('first started');
    await gate;
    events.push('first ended');
  });
  const second = queue.run(async () => {
    events.push('second started');
  });
  openGate();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first started', 'first ended', 'second started']);
});

test('an action that fails does not stop the next one, and each caller gets its own result', async () => {
  const queue = new SerialQueue();
  const failure = new Error('disk is full');
  const failed = queue.run(() => Promise.reject(failure));
  const next = queue.run(() => Promise.resolve('saved'));
  await assert.rejects(failed, error => error === failure);
  assert.equal(await next, 'saved');
});

test('the queue drains once every queued action has settled, failed ones included', async () => {
  const queue = new SerialQueue();
  const settled: string[] = [];
  void queue.run(() => Promise.reject(new Error('disk is full'))).catch(() => settled.push('failed'));
  void queue.run(async () => settled.push('saved'));
  await queue.drained();
  assert.deepEqual(settled, ['failed', 'saved']);
});
