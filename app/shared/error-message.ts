// A caught value is `unknown`: code may throw strings or plain objects, so
// only an Error contributes its message and anything else its string form.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
