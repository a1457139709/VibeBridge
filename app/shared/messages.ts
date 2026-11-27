import { z } from 'zod';
import { english } from './localization/locales/en';
import { parseJsonText } from './json-text';

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

const messagePrefix = 'VibeBridge.message:';

const messageFields = (id: MessageId) => [
  ...new Set(Array.from(english[id].matchAll(/\{(\w+)\}/g), match => match[1])),
];

const messageValueSchema: z.ZodType<MessageValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.object({ message: z.string() }), z.array(messageValueSchema).readonly()]),
);
const envelopeShape = z.object({
  id: z.string(),
  values: z.record(z.string(), messageValueSchema).optional(),
});
const isMessageId = (id: string): id is MessageId => Object.hasOwn(english, id);
const referenceSchema = z.custom<MessageReference>(value => {
  const parsed = envelopeShape.safeParse(value);
  if (!parsed.success || !isMessageId(parsed.data.id)) return false;
  const { values = {} } = parsed.data;
  return messageFields(parsed.data.id).every(field => Object.hasOwn(values, field));
});

export const referenceValues = (reference: MessageReference): MessageValues | undefined =>
  'values' in reference ? reference.values : undefined;

const envelopeOf = (id: MessageId, values: MessageValues | undefined) =>
  messagePrefix + JSON.stringify(referenceSchema.parse({ id, values }));
export function message<K extends MessageId>(id: K, ...args: MessageArguments<K>): string {
  return envelopeOf(id, args[0]);
}
export function envelope(reference: MessageReference): string {
  return envelopeOf(reference.id, referenceValues(reference));
}

export type ReadText = { kind: 'message'; reference: MessageReference } | { kind: 'plain' } | { kind: 'malformed' };

export function readEnvelope(text: string): ReadText {
  if (!text.startsWith(messagePrefix)) return { kind: 'plain' };
  const parsed = parseJsonText(text.slice(messagePrefix.length), referenceSchema);
  return parsed.success ? { kind: 'message', reference: parsed.data } : { kind: 'malformed' };
}

export const nestedMessage = (text: string): MessageValue => ({ message: text });
