import type { Language } from '../model';
import {
  messagePrefix,
  type MessageArguments,
  type MessageId,
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
    return catalogs[language][id].replace(/\{(\w+)\}/g, (_, key: string) => valueText(values[key] ?? ''));
  }
  function localizeText(value: string): string {
    const input = value.replace(/^Error invoking remote method '[^']+': Error: /, '');
    if (!input.startsWith(messagePrefix)) return input;
    try {
      const parsed = JSON.parse(input.slice(messagePrefix.length));
      if (Object.hasOwn(english, parsed.id)) return format(parsed.id, parsed.values);
    } catch {}
    return input;
  }
  return {
    language,
    t: <K extends MessageId>(id: K, ...args: MessageArguments<K>) => format(id, args[0]),
    text: localizeText,
  };
}
