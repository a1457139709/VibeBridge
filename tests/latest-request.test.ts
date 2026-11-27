import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestRequest } from '../app/shared/latest-request';

test('a started request is the latest until a newer one starts', () => {
  const requests = new LatestRequest();
  const older = requests.start();
  assert.equal(requests.isLatest(older), true);
  const newer = requests.start();
  assert.equal(requests.isLatest(older), false);
  assert.equal(requests.isLatest(newer), true);
});

test('only the latest request finishes, and finishing leaves nothing pending', () => {
  const requests = new LatestRequest();
  const older = requests.start();
  const newer = requests.start();
  assert.equal(requests.finish(older), false);
  assert.equal(requests.pending, true);
  assert.equal(requests.finish(newer), true);
  assert.equal(requests.pending, false);
  assert.equal(requests.isLatest(newer), false);
});

test("one guard's request is never the latest of another guard", () => {
  const first = new LatestRequest(),
    second = new LatestRequest();
  const ticket = first.start();
  second.start();
  assert.equal(second.isLatest(ticket), false);
});

test('nothing is pending before a request starts', () => {
  assert.equal(new LatestRequest().pending, false);
});
