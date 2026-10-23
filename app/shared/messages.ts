import type { english } from './locales/en';

export type MessageId = keyof typeof english;
export type MessageValue = string | number | { message: string } | readonly MessageValue[];
export type MessageValues = Record<string, MessageValue>;
type Fields<T extends string> = T extends `${string}{${infer Field}}${infer Rest}` ? Field | Fields<Rest> : never;
export type MessageArguments<K extends MessageId> = [Fields<typeof english[K]>] extends [never]
  ? [values?: never] : [values: Record<Fields<typeof english[K]>, MessageValue>];

// Existing error/notice channels cross Electron and child-process boundaries as
// strings. Carry an explicit envelope instead of matching translated sentences.
// This module has no runtime dependency on React or either dictionary.
export const messagePrefix = 'VibeBridge.message:';
export function message<K extends MessageId>(id: K, ...args: MessageArguments<K>): string {
  return messagePrefix + JSON.stringify({ id, values: args[0] });
}

// Only explicit nested messages are formatted; user names, paths and external
// details passed as ordinary strings remain byte-for-byte unchanged.
export const detail = (text: string): MessageValue => ({ message: text });
