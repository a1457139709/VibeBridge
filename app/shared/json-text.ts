import type { z } from 'zod';

export type JsonTextResult<T> = { success: true; data: T } | { success: false };

export function parseJsonText<T>(text: string, schema: z.ZodType<T>): JsonTextResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return { success: false };
    throw error;
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { success: true, data: parsed.data } : { success: false };
}
