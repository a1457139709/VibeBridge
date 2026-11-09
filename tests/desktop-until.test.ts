import assert from 'node:assert/strict';
import test from 'node:test';
const until: (check: () => unknown, label: string, options?: { timeout?: number; context?: () => unknown }) => Promise<void> = require('./desktop/support/until.cjs');

test('desktop waits resolve once the check holds', async () => {
  let calls = 0;
  await until(() => ++calls === 3, 'third poll');
  assert.equal(calls, 3);
});

test('desktop waits require a label naming the awaited behaviour', async () => {
  let calls = 0;
  await assert.rejects(until(() => ++calls, undefined as unknown as string), /label/);
  await assert.rejects(until(() => ++calls, '  '), /label/);
  assert.equal(calls, 0);
});

test('a timed-out desktop wait names its label and the last value the check returned', async () => {
  let calls = 0;
  await assert.rejects(until(() => (++calls, null), 'tray card for panel B drawn', { timeout: 50 }),
    { message: 'Timed out waiting for: tray card for panel B drawn (last: null)' });
  assert.ok(calls > 1);
  await assert.rejects(until(() => '', 'empty output', { timeout: 0 }), { message: 'Timed out waiting for: empty output (last: \'\')' });
});

test('a timed-out desktop wait appends what its context callback describes', async () => {
  await assert.rejects(until(() => false, 'echo of k', { timeout: 0, context: async () => 'rows: READY:' }),
    { message: 'Timed out waiting for: echo of k (last: false)\nrows: READY:' });
  await assert.rejects(until(() => false, 'echo of k', { timeout: 0, context: () => { throw new Error('renderer gone'); } }),
    { message: 'Timed out waiting for: echo of k (last: false)\ncontext unavailable: renderer gone' });
});

test('a context callback that never answers still lets the timed-out wait report its label', async () => {
  await assert.rejects(until(() => false, 'echo of k', { timeout: 0, context: () => new Promise(() => {}) }),
    { message: 'Timed out waiting for: echo of k (last: false)\ncontext unavailable: no answer within 2000 ms' });
});
