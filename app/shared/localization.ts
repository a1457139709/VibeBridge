import type { Language } from './model';
import { messagePrefix, type MessageArguments, type MessageId, type MessageValue, type MessageValues } from './messages';
import { english } from './locales/en';
import { chinese } from './locales/zh-CN';

/** Electron prefixes errors that cross IPC; the message is what follows. */
export const remoteErrorText = (value: string) => value.replace(/^Error invoking remote method '[^']+': Error: /, '');

export function localize(language: Language) {
  const separator = language === 'zh-CN' ? '、' : ', ';
  const valueText = (value: MessageValue): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if ('message' in value) return text(value.message);
    return value.map(valueText).join(separator);
  };
  function format(id: MessageId, values: MessageValues = {}): string {
    return (language === 'zh-CN' ? chinese : english)[id].replace(/\{(\w+)\}/g, (_, key: string) => valueText(values[key] ?? ''));
  }
  function text(value: string): string {
    const input = remoteErrorText(value);
    if (!input.startsWith(messagePrefix)) return input;
    try {
      const parsed = JSON.parse(input.slice(messagePrefix.length));
      if (Object.hasOwn(english, parsed.id)) return format(parsed.id, parsed.values);
    } catch { /* External error details are kept as received. */ }
    return input;
  }
  return { language, t: <K extends MessageId>(id: K, ...args: MessageArguments<K>) => format(id, args[0]), text };
}
