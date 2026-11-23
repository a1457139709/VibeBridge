import type { english } from './localization/locales/en';

export type MessageId = keyof typeof english;
export type MessageValue = string | number | { message: string } | readonly MessageValue[];
export type MessageValues = Record<string, MessageValue>;
type Fields<T extends string> = T extends `${string}{${infer Field}}${infer Rest}` ? Field | Fields<Rest> : never;
export type MessageArguments<K extends MessageId> = [Fields<(typeof english)[K]>] extends [never]
  ? [values?: never]
  : [values: Record<Fields<(typeof english)[K]>, MessageValue>];

export type MessageReference = {
  [K in MessageId]: [Fields<(typeof english)[K]>] extends [never]
    ? { id: K }
    : { id: K; values: Record<Fields<(typeof english)[K]>, MessageValue> };
}[MessageId];

export const messagePrefix = 'VibeBridge.message:';
const envelopeOf = (id: MessageId, values: MessageValues | undefined) => messagePrefix + JSON.stringify({ id, values });
export function message<K extends MessageId>(id: K, ...args: MessageArguments<K>): string {
  return envelopeOf(id, args[0]);
}
export function envelope(reference: MessageReference): string {
  return envelopeOf(reference.id, 'values' in reference ? reference.values : undefined);
}

export const nestedMessage = (text: string): MessageValue => ({ message: text });
