import type { Run } from '../../app/shared/model';
import { requireValue } from '../../app/renderer/common/required';

/** The first capture group of `pattern`'s first match in `text`, which a test expects a helper process to have printed. */
export function firstCapture(text: string, pattern: RegExp): string {
  return requireValue(text.match(pattern), `output matching ${pattern}`)[1];
}

/** The last of `items`, which a test expects to hold at least one. */
export function lastOf<T>(items: readonly T[]): T {
  return requireValue(items.at(-1), 'a last item');
}

/** The process ID of a run a test expects to have started. */
export function pidOf(run: Run): number {
  return requireValue(run.pid, `a process for run ${run.id}`);
}
