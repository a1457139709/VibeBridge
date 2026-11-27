import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUpAfterFailure, errorCode, errorMessage } from '../app/shared/caught-error';

test('an Error is shown by its message', () => {
  assert.equal(errorMessage(new Error('disk is full')), 'disk is full');
});

test('a thrown string is shown as it was thrown', () => {
  assert.equal(errorMessage('connection reset'), 'connection reset');
});

test('a thrown plain object is shown in its string form, not as undefined', () => {
  assert.equal(errorMessage({ code: 'EPIPE' }), '[object Object]');
});

test('a Node.js system error gives its code', () => {
  assert.equal(errorCode(Object.assign(new Error('no such file'), { code: 'ENOENT' })), 'ENOENT');
});

test('an Error without a code gives none', () => {
  assert.equal(errorCode(new Error('disk is full')), undefined);
});

test('a thrown plain object gives no code, even one carrying a code field: only an Error is a system error', () => {
  assert.equal(errorCode({ code: 'EPIPE' }), undefined);
});

test('a thrown string gives no code', () => {
  assert.equal(errorCode('ENOENT'), undefined);
});

test('cleaning up after a failure settles whether the cleanup succeeds or fails', async () => {
  assert.equal(await cleanUpAfterFailure(Promise.resolve('removed')), undefined);
  assert.equal(await cleanUpAfterFailure(Promise.reject(new Error('busy'))), undefined);
});
