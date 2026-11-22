import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMessage } from '../app/shared/error-message';

test('an Error is shown by its message', () => {
  assert.equal(errorMessage(new Error('disk is full')), 'disk is full');
});

test('a thrown string is shown as it was thrown', () => {
  assert.equal(errorMessage('connection reset'), 'connection reset');
});

test('a thrown plain object is shown in its string form, not as undefined', () => {
  assert.equal(errorMessage({ code: 'EPIPE' }), '[object Object]');
});
