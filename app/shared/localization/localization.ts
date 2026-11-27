import type { Language } from '../model';
import {
  readEnvelope,
  referenceValues,
  type MessageArguments,
  type MessageId,
  type MessageReference,
  type MessageValue,
  type MessageValues,
} from '../messages';
import { english } from './locales/en';
import { chinese } from './locales/zh-CN';

export const catalogs: Record<Language, Record<MessageId, string>> = { en: english, 'zh-CN': chinese };

export function localize(language: Language) {
  const separator = language === 'zh-CN' ? '、' : ', ';
  const valueText = (value: MessageValue): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if ('message' in value) return localizeText(value.message);
    return value.map(valueText).join(separator);
  };
  function format(id: MessageId, values: MessageValues = {}): string {
    return catalogs[language][id].replace(/\{(\w+)\}/g, (_, key: string) => {
      if (!Object.hasOwn(values, key)) throw new Error(`Message ${id} has no value for {${key}}`);
      return valueText(values[key]);
    });
  }
  function localizeText(value: string): string {
    const input = value.replace(/^Error invoking remote method '[^']+': Error: /, '');
    const read = readEnvelope(input);
    if (read.kind === 'plain') return input;
    if (read.kind === 'malformed') return format('malformedMessage');
    return format(read.reference.id, referenceValues(read.reference));
  }
  return {
    language,
    t: <K extends MessageId>(id: K, ...args: MessageArguments<K>) => format(id, args[0]),
    translate: (reference: MessageReference) => format(reference.id, referenceValues(reference)),
    text: localizeText,
  };
}
