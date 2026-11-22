import type { english } from './localization/locales/en';

export type MessageId = keyof typeof english;
export type MessageValue = string | number | { message: string } | readonly MessageValue[];
export type MessageValues = Record<string, MessageValue>;
type Fields<T extends string> = T extends `${string}{${infer Field}}${infer Rest}` ? Field | Fields<Rest> : never;
export type MessageArguments<K extends MessageId> = [Fields<(typeof english)[K]>] extends [never]
  ? [values?: never]
  : [values: Record<Fields<(typeof english)[K]>, MessageValue>];

export const messagePrefix = 'VibeBridge.message:';
export function message<K extends MessageId>(id: K, ...args: MessageArguments<K>): string {
  return messagePrefix + JSON.stringify({ id, values: args[0] });
}

export const nestedMessage = (text: string): MessageValue => ({ message: text });
