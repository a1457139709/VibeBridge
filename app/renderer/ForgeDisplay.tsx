import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { BlockedIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, IssueClosedIcon, IssueOpenedIcon, SkipIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import { filterForgeHtml } from '../shared/forge-html';
import type { ChecksConclusion, ForgeLabel, ForgeLinks, IssueSummary, PullRequestState, SubIssueProgress } from '../shared/forge';

// How the forge sidebar's lists and details show an issue's state, labels, age, sub-issue progress and blockers,
// a pull request's state and checks, and the posts and links of a detail.

/** An issue or pull request of the bound repository, as the detail opens it. */
export interface DetailItem { kind: 'issue' | 'pullRequest'; number: number }
/** The item a link to `url` names when it is an issue or pull request of the bound repository, else null. */
export function linkedItem(url: string, links: ForgeLinks): DetailItem | null {
  for (const kind of ['issue', 'pullRequest'] as const) {
    const prefix = kind === 'issue' ? links.issues : links.pullRequests;
    // Repository paths in a forge's URLs may differ in case from the bound one.
    if (!url.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const match = /^(\d+)(?:[?#].*)?$/.exec(url.slice(prefix.length));
    if (match) return { kind, number: Number(match[1]) };
  }
  return null;
}

/** A reference to an issue or pull request of `kind`: one of the bound repository opens in the detail, any other in the browser. */
export function ItemReference({ kind, url, links, open, className, hint, children }: {
  kind: DetailItem['kind']; url: string; links: ForgeLinks; open(item: DetailItem): void; className: string; hint: string; children: ReactNode;
}) {
  const item = linkedItem(url, links);
  return item?.kind === kind
    ? <button className={className} data-hint={hint} onClick={() => open(item)}>{children}</button>
    : <a className={className} href={url} target="_blank" rel="noreferrer" data-hint={hint}>{children}</a>;
}

/** A message whose values are elements: `format` receives a marker per slot, and each marker in its text becomes that slot's element. */
export function withElements(format: (markers: Record<string, string>) => string, slots: Record<string, ReactNode>): ReactNode[] {
  const markers = Object.fromEntries(Object.keys(slots).map(key => [key, `\u0000${key}\u0000`]));
  return format(markers).split('\u0000').map((part, index) => index % 2 ? <span key={index}>{slots[part]}</span> : part);
}

/** A body, comment or review summary: who wrote it, the review's verdict if any, and when; then the forge's HTML through the filter. */
export function Post({ author, createdAt, html, verdict }: { author: string | null; createdAt: string; html: string; verdict?: ReactNode }) {
  const { t } = useLocalization();
  const filtered = useMemo(() => filterForgeHtml(html), [html]);
  return <article className="forge-card">
    <header><b>{author ?? t('deletedAccount')}</b> {verdict && <>{verdict} </>}<RelativeTime iso={createdAt} /></header>
    {filtered.trim() ? <div className="forge-markdown" dangerouslySetInnerHTML={{ __html: filtered }} /> : <p className="forge-markdown-empty">{t('noDescription')}</p>}
  </article>;
}

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

/** How many of an issue's sub-issues are closed, as a bar and a count; the hint says it in words. */
export function Progress({ closed, total }: SubIssueProgress) {
  const { t } = useLocalization();
  return <span className="forge-progress" data-hint={t('subIssueProgress', { closed, total })}>
    <span className="forge-progress-bar"><span style={{ width: `${total ? closed / total * 100 : 0}%` }} /></span>{closed}/{total}</span>;
}

/** The blocked mark as the forge shows it: the blocked icon and the blockers, with how many more the forge did not list;
 * the hint names them. */
export function BlockedMark({ by, unlisted = 0 }: { by: { reference: string; title: string }[]; unlisted?: number }) {
  const { t } = useLocalization();
  const more = unlisted ? [t('moreBlockers', { count: unlisted })] : [];
  const names = [...by.map(blocker => blocker.reference), ...more].join(', ');
  return <span className="forge-blocked" role="img" aria-label={t('blockedBy', { issues: names })}
    data-hint={[...by.map(blocker => `${blocker.reference} ${blocker.title}`), ...more].join('\n')}><BlockedIcon size={12} />{names}</span>;
}

/** The forge's pull request octicons and colours: open green, draft grey, merged purple, closed red; with the name an
 * icon gives the state and the shorter one a state pill shows. */
const pullRequestStates = {
  open: { Icon: GitPullRequestIcon, tone: 'open', name: 'pullRequestOpen', short: 'stateOpen' },
  draft: { Icon: GitPullRequestDraftIcon, tone: 'skipped', name: 'pullRequestDraft', short: 'stateDraft' },
  merged: { Icon: GitMergeIcon, tone: 'done', name: 'pullRequestMerged', short: 'stateMerged' },
  closed: { Icon: GitPullRequestClosedIcon, tone: 'failed', name: 'pullRequestClosed', short: 'stateClosed' },
} as const;

/** A pull request's state octicon in the forge's colour; inside an element with its own hint, it gives none. */
export function PullRequestIcon({ state, size = 16, hint = true }: { state: PullRequestState; size?: number; hint?: boolean }) {
  const { t } = useLocalization();
  const { Icon, tone, name } = pullRequestStates[state];
  return <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)} data-hint={hint ? t(name) : undefined}><Icon size={size} /></span>;
}

/** A pull request's state as a pill: its icon and name on the state's colour. */
export function PullRequestPill({ state }: { state: PullRequestState }) {
  const { t } = useLocalization();
  const { tone, short } = pullRequestStates[state];
  return <span className={`forge-pill forge-bg-${tone}`}><PullRequestIcon state={state} hint={false} />{t(short)}</span>;
}

/** Each checks conclusion's mark, name and colour. */
const conclusions = {
  passed: { mark: '✓', name: 'checksPassed', tone: 'open' },
  failed: { mark: '✗', name: 'checksFailed', tone: 'failed' },
  pending: { mark: '●', name: 'checksPending', tone: 'pending' },
} as const;

/** The checks conclusion of an open or draft pull request; nothing for a merged or closed one, or one without checks. */
export function OpenChecks({ state, checks }: { state: PullRequestState; checks: ChecksConclusion }) {
  const { t } = useLocalization();
  if ((state !== 'open' && state !== 'draft') || checks === 'none') return null;
  const { mark, name, tone } = conclusions[checks];
  return <span className={`forge-checks forge-${tone}`}>{mark} {t(name)}</span>;
}
