export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

export async function cleanUpAfterFailure(cleanup: Promise<unknown>): Promise<void> {
  await cleanup.then(
    () => undefined,
    () => undefined,
  );
}
