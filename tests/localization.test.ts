import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, localize } from '../app/shared/localization/localization';
import { envelope, type MessageId, type MessageReference, type MessageValues } from '../app/shared/messages';
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

const messageIds = Object.keys(catalogs.en).filter((id): id is MessageId => Object.hasOwn(catalogs.en, id));
const referenceTo = (id: MessageId, values: MessageValues): MessageReference =>
  JSON.parse(JSON.stringify({ id, values }));

test("every enveloped message reads back as that language's translation with its values filled in", () => {
  const mismatches = languages.flatMap(language => {
    const { text } = localize(language);
    return messageIds.flatMap(id => {
      const values = Object.fromEntries(placeholders(catalogs.en[id]).map(key => [key, `«${key}»`]));
      const shown = text(envelope(referenceTo(id, values)));
      const expected = catalogs[language][id].replace(/\{(\w+)\}/g, (_, key: string) => `«${key}»`);
      return shown === expected ? [] : [{ language, id, shown, expected }];
    });
  });
  assert.deepEqual(mismatches, []);
});

test('text that is not an envelope is shown as it is', () => {
  const { text } = localize('en');
  assert.equal(text('gh: not found'), 'gh: not found');
});

test('an envelope with an unknown id or a missing value is reported as unreadable, never shown raw', () => {
  const { t, text } = localize('en');
  const malformed = [
    'VibeBridge.message:{"id":"noSuchMessage"}',
    'VibeBridge.message:{"id":"settingsReadFailed"}',
    'VibeBridge.message:{"id":"settingsReadFailed","values":{"reason":true}}',
    'VibeBridge.message:not json',
  ];
  assert.deepEqual(
    malformed.map(input => text(input)),
    malformed.map(() => t('malformedMessage')),
  );
});

test('a reference missing one of its values fails to format instead of showing a blank', () => {
  const { translate } = localize('en');
  assert.throws(() => translate(referenceTo('settingsReadFailed', {})));
});

test('an envelope cannot be built for a message whose values are missing', () => {
  assert.throws(() => envelope(referenceTo('settingsReadFailed', {})));
});
