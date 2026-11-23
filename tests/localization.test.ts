import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../app/shared/localization/localization';
import { languages } from '../app/shared/model';

const placeholders = (text: string) => [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), match => match[1]))].sort();

test('every translation uses exactly the placeholders of its English message', () => {
  const mismatches = languages.flatMap(language =>
    Object.entries(catalogs.en).flatMap(([id, english]) => {
      const expected = placeholders(english);
      const actual = placeholders(new Map(Object.entries(catalogs[language])).get(id) ?? '');
      return actual.join() === expected.join() ? [] : [{ language, id, expected, actual }];
    }),
  );
  assert.deepEqual(mismatches, []);
});
