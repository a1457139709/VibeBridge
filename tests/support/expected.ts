import type { Run } from '../../app/shared/model';
import { requireValue } from '../../app/renderer/common/required';

export function firstCapture(text: string, pattern: RegExp): string {
  return requireValue(text.match(pattern), `output matching ${pattern}`)[1];
}

export function lastOf<T>(items: readonly T[]): T {
  return requireValue(items.at(-1), 'a last item');
}

export function pidOf(run: Run): number {
  return requireValue(run.pid, `a process for run ${run.id}`);
}
