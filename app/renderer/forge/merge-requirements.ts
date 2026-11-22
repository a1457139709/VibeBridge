import type { Check, CheckTone, MergeState, PullRequestDetail } from '../../shared/forge/forge';
import type { localize } from '../../shared/localization/localization';

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

export type Translate = ReturnType<typeof localize>['t'];
interface MergeContext {
  t: Translate;
  base: string;
  forge: string;
}
interface MergeStateView {
  mark: string;
  tone: string;
  text(context: MergeContext): string;
  blockedBecause: ((context: MergeContext) => string) | null;
}

export const mergeStates: Record<MergeState, MergeStateView> = {
  clean: { mark: '✓', tone: 'open', text: ({ t }) => t('mergeStateClean'), blockedBecause: null },
  hasHooks: { mark: '✓', tone: 'open', text: ({ t }) => t('mergeStateClean'), blockedBecause: null },
  unstable: { mark: '●', tone: 'pending', text: ({ t }) => t('mergeStateUnstable'), blockedBecause: null },
  dirty: {
    mark: '✗',
    tone: 'failed',
    text: ({ t, base }) => t('mergeStateDirty', { base }),
    blockedBecause: ({ t }) => t('mergeBlockedDirty'),
  },
  behind: {
    mark: '✗',
    tone: 'failed',
    text: ({ t, base }) => t('mergeStateBehind', { base }),
    blockedBecause: ({ t, base }) => t('mergeBlockedBehind', { base }),
  },
  blocked: {
    mark: '✗',
    tone: 'failed',
    text: ({ t }) => t('mergeStateBlocked'),
    blockedBecause: ({ t, forge }) => t('mergeBlockedBlocked', { forge }),
  },
  unknown: {
    mark: '●',
    tone: 'pending',
    text: ({ t, forge }) => t('mergeStateUnknown', { forge }),
    blockedBecause: ({ t, forge }) => t('mergeBlockedUnknown', { forge }),
  },
};

export function mergeBlockedReasons(
  { state, mergeState, base }: Pick<PullRequestDetail, 'state' | 'mergeState' | 'base'>,
  forge: string,
  t: Translate,
): string[] {
  const blockedBecause = mergeState && mergeStates[mergeState].blockedBecause;
  return [
    ...(state === 'draft' ? [t('mergeBlockedDraft')] : []),
    ...(blockedBecause ? [blockedBecause({ t, base, forge })] : []),
  ];
}
