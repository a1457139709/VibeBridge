import assert from 'node:assert/strict';
import type { Run } from '../../app/shared/model';

/** The first capture group of `pattern`'s first match in `text`, which a test expects a helper process to have printed. */
export function firstCapture(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  assert.ok(match, `the output matches ${pattern}`);
  return match[1];
}

/** The last of `items`, which a test expects to hold at least one. */
export function lastOf<T>(items: readonly T[]): T {
  const last = items.at(-1);
  assert.ok(last !== undefined, 'there is a last item');
  return last;
}

/** The process ID of a run a test expects to have started. */
export function pidOf(run: Run): number {
  assert.ok(run.pid !== undefined, `run ${run.id} has a process`);
  return run.pid;
}
