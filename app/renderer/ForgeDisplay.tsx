import type { CSSProperties } from 'react';
import { IssueClosedIcon, IssueOpenedIcon, SkipIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import type { ForgeLabel, IssueSummary } from '../shared/forge';

// How the forge sidebar's lists and details show an issue's state, its labels and its age.

/** How an issue stands: open, or closed as completed, not planned or a duplicate (completed when the forge does not tell). */
export const issueState = (issue: Pick<IssueSummary, 'state' | 'closedAs'>) => issue.state === 'open' ? 'open' as const : issue.closedAs ?? 'completed';
/** Each state's octicon and colour, as the forge shows them (open green, completed purple, not planned or duplicate grey),
 * with the name an icon gives it and the shorter one a state pill shows. */
export const issueStates = {
  open: { Icon: IssueOpenedIcon, tone: 'open', name: 'issueOpen', short: 'stateOpen' },
  completed: { Icon: IssueClosedIcon, tone: 'done', name: 'issueCompleted', short: 'stateCompleted' },
  notPlanned: { Icon: SkipIcon, tone: 'skipped', name: 'issueNotPlanned', short: 'stateNotPlanned' },
  duplicate: { Icon: SkipIcon, tone: 'skipped', name: 'issueDuplicate', short: 'stateDuplicate' },
} as const;

/** An issue's state octicon in the forge's colour. A decorative icon sits next to text that already names the state. */
export function IssueIcon({ issue, size = 16, decorative = false }: { issue: Pick<IssueSummary, 'state' | 'closedAs'>; size?: number; decorative?: boolean }) {
  const { t } = useLocalization();
  const { Icon, tone, name } = issueStates[issueState(issue)];
  return decorative ? <span className={`forge-icon forge-${tone}`}><Icon size={size} /></span>
    : <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)} data-hint={t(name)}><Icon size={size} /></span>;
}

/** A label in the forge's colour; with `onClick` it is a button. */
export function Label({ label, onClick }: { label: ForgeLabel; onClick?(): void }) {
  const style = { '--label': `#${label.color}` } as CSSProperties;
  return onClick ? <button className="forge-label clickable" style={style} onClick={event => { event.stopPropagation(); onClick(); }}>{label.name}</button>
    : <span className="forge-label" style={style}>{label.name}</span>;
}

export function RelativeTime({ iso }: { iso: string }) {
  const { t, language } = useLocalization();
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  const text = seconds < 60 ? t('justNow')
    : seconds < 3600 ? t('minutesAgo', { count: Math.floor(seconds / 60) })
    : seconds < 86400 ? t('hoursAgo', { count: Math.floor(seconds / 3600) })
    : seconds < 86400 * 30 ? t('daysAgo', { count: Math.floor(seconds / 86400) })
    : date.toLocaleDateString(language);
  return <time dateTime={iso} data-hint={date.toLocaleString(language)}>{text}</time>;
}
