export type AnimationOutcome = 'finished' | 'cancelled';

const isAbort = (error: unknown) =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

export async function playToEnd(animation: { finished: Promise<unknown> }): Promise<AnimationOutcome> {
  try {
    await animation.finished;
    return 'finished';
  } catch (error) {
    if (isAbort(error)) return 'cancelled';
    throw error;
  }
}
