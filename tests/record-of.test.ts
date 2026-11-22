import test from 'node:test';
import assert from 'node:assert/strict';
import { recordOf } from '../app/shared/record-of';

const catalog = [
  { id: 'review', label: 'Review' },
  { id: 'ship', label: 'Ship' },
] as const;

test('a catalog gives a record with one entry under each item key', () => {
  assert.deepEqual(
    recordOf(
      catalog,
      item => item.id,
      item => item.label,
    ),
    { review: 'Review', ship: 'Ship' },
  );
});

test('a catalog with two items under one key is refused rather than losing one of them', () => {
  assert.throws(
    () =>
      recordOf(
        [...catalog, { id: 'ship', label: 'Ship again' }],
        item => item.id,
        item => item.label,
      ),
    /two entries under ship/,
  );
});
