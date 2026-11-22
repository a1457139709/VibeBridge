import type { Check, CheckTone, MergeState, PullRequestDetail } from '../../shared/forge/forge';

export const checkTones: Record<CheckTone, { mark: string; tone: string }> = {
  passed: { mark: '✓', tone: 'open' },
  failed: { mark: '✗', tone: 'failed' },
  pending: { mark: '●', tone: 'pending' },
  neutral: { mark: '–', tone: 'skipped' },
};

export type CheckDuration =
  | { unit: 'seconds'; seconds: number }
  | { unit: 'minutes'; minutes: number; seconds: number }
  | { unit: 'hours'; hours: number; minutes: number };

export function checkDuration({
  startedAt,
  completedAt,
}: Pick<Check, 'startedAt' | 'completedAt'>): CheckDuration | null {
  if (startedAt === null || completedAt === null) return null;
  const elapsed = Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000));
  const hours = Math.floor(elapsed / 3600),
    minutes = Math.floor((elapsed % 3600) / 60),
    seconds = elapsed % 60;
  if (hours) return { unit: 'hours', hours, minutes };
  if (minutes) return { unit: 'minutes', minutes, seconds };
  return { unit: 'seconds', seconds };
}

export const unlistedChecks = ({ checks }: Pick<PullRequestDetail, 'checks'>) =>
  Math.max(0, checks.total - checks.listed.length);

export type MergeBlock = 'draft' | 'dirty' | 'behind' | 'blocked' | 'unknown';
const stateBlocks: Record<MergeState, MergeBlock | null> = {
  clean: null,
  hasHooks: null,
  unstable: null,
  dirty: 'dirty',
  behind: 'behind',
  blocked: 'blocked',
  unknown: 'unknown',
};

export const mergeBlocks = ({ state, mergeState }: Pick<PullRequestDetail, 'state' | 'mergeState'>): MergeBlock[] =>
  [state === 'draft' ? 'draft' : null, stateBlocks[mergeState]].filter((block): block is MergeBlock => block !== null);
