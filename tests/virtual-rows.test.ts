import test from 'node:test';
import assert from 'node:assert/strict';
import { readingPositionAt, restoredScrollTop, rowWindow } from '../app/renderer/forge/virtual-rows';

const tenRows = Array(10).fill(40);

test('the window holds the rows in view and the overscan around them, with the space of the rows outside it', () => {
  assert.deepEqual(rowWindow(tenRows, { scrollTop: 100, viewport: 100, overscan: 1 }), {
    start: 1,
    end: 6,
    before: 40,
    after: 160,
  });
  assert.deepEqual(rowWindow(tenRows, { scrollTop: 0, viewport: 1000, overscan: 2 }), {
    start: 0,
    end: 10,
    before: 0,
    after: 0,
  });
  assert.deepEqual(rowWindow([], { scrollTop: 0, viewport: 100, overscan: 2 }), {
    start: 0,
    end: 0,
    before: 0,
    after: 0,
  });
});

test('the window follows rows of different heights', () => {
  assert.deepEqual(rowWindow([100, 20, 20, 100, 20], { scrollTop: 110, viewport: 30, overscan: 0 }), {
    start: 1,
    end: 3,
    before: 100,
    after: 120,
  });
});

test('the reading position is the top row in view, with how far it is scrolled past', () => {
  assert.deepEqual(readingPositionAt([5, 6, 7, 8], tenRows, 90), { key: 7, index: 2, offset: 10 });
  assert.deepEqual(readingPositionAt([5, 6], tenRows.slice(0, 2), 0), { key: 5, index: 0, offset: 0 });
  assert.equal(readingPositionAt([], [], 0), null);
});

test('the reading position returns to its row wherever it now is, and else to the row at its old place', () => {
  const position = { key: 7, index: 2, offset: 10 };
  assert.equal(restoredScrollTop(position, [1, 5, 6, 7], tenRows), 130, 'row 7 moved down one place');
  assert.equal(restoredScrollTop(position, [5, 6, 8, 9], tenRows), 90, 'row 7 is gone: the row now third');
  assert.equal(restoredScrollTop(position, [5], tenRows.slice(0, 1)), 10, 'fewer rows: the last one');
  assert.equal(restoredScrollTop(position, [], []), 0);
});
