// A caught value is `unknown`: code may throw strings or plain objects, so
// only an Error contributes its message and anything else its string form.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `code` a caught Node.js system error carries (`ENOENT`, `ESRCH`, …); undefined for anything else. */
export function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}
