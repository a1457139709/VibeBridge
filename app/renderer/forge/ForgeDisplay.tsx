import { useMemo, type CSSProperties, type ReactNode } from 'react';
import {
  BlockedIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { useLocalization } from '../common/Localization';
import { filterForgeHtml } from '../../shared/forge/forge-html';
import type {
  ChecksConclusion,
  ForgeLabel,
  ForgeLinks,
  IssueSummary,
  PullRequestState,
  SubIssueProgress,
} from '../../shared/forge/forge';
import type { DetailItem } from '../../shared/forge/sidebar-data';

export function linkedItem(url: string, links: ForgeLinks): DetailItem | null {
  for (const kind of ['issue', 'pullRequest'] as const) {
    const prefix = kind === 'issue' ? links.issuePrefix : links.pullRequestPrefix;
    if (!url.toLowerCase().startsWith(prefix.toLowerCase())) continue;
    const match = /^(\d+)(?:[?#].*)?$/.exec(url.slice(prefix.length));
    if (match) return { kind, number: Number(match[1]) };
  }
  return null;
}

export function ItemReference({
  kind,
  url,
  links,
  open,
  className,
  hint,
  children,
}: {
  kind: DetailItem['kind'];
  url: string;
  links: ForgeLinks;
  open(item: DetailItem): void;
  className: string;
  hint: string;
  children: ReactNode;
}) {
  const item = linkedItem(url, links);
  return item?.kind === kind ? (
    <button className={className} data-hint={hint} onClick={() => open(item)}>
      {children}
    </button>
  ) : (
    <a className={className} href={url} target="_blank" rel="noreferrer" data-hint={hint}>
      {children}
    </a>
  );
}

export function withElements(
  format: (markers: Record<string, string>) => string,
  slots: Record<string, ReactNode>,
): ReactNode[] {
  const markers = Object.fromEntries(Object.keys(slots).map(key => [key, `\u0000${key}\u0000`]));
  return format(markers)
    .split('\u0000')
    .map((part, index) => (index % 2 ? <span key={index}>{slots[part]}</span> : part));
}

export function Post({
  author,
  createdAt,
  html,
  verdict,
}: {
  author: string | null;
  createdAt: string;
  html: string;
  verdict?: ReactNode;
}) {
  const { t } = useLocalization();
  const filtered = useMemo(() => filterForgeHtml(html), [html]);
  return (
    <article className="forge-card">
      <header>
        <b>{author ?? t('deletedAccount')}</b> {verdict && <>{verdict} </>}
        <RelativeTime iso={createdAt} />
      </header>
      {filtered.trim() ? (
        <div className="forge-markdown" dangerouslySetInnerHTML={{ __html: filtered }} />
      ) : (
        <p className="forge-markdown-empty">{t('noDescription')}</p>
      )}
    </article>
  );
}

export const issueDisplayState = (issue: Pick<IssueSummary, 'state' | 'closedAs'>) =>
  issue.state === 'open' ? ('open' as const) : (issue.closedAs ?? 'completed');
export const issueStates = {
  open: { Icon: IssueOpenedIcon, tone: 'open', name: 'issueOpen', short: 'stateOpen' },
  completed: { Icon: IssueClosedIcon, tone: 'done', name: 'issueCompleted', short: 'stateCompleted' },
  notPlanned: { Icon: SkipIcon, tone: 'skipped', name: 'issueNotPlanned', short: 'stateNotPlanned' },
  duplicate: { Icon: SkipIcon, tone: 'skipped', name: 'issueDuplicate', short: 'stateDuplicate' },
} as const;

export function IssueIcon({
  issue,
  size = 16,
  decorative = false,
}: {
  issue: Pick<IssueSummary, 'state' | 'closedAs'>;
  size?: number;
  decorative?: boolean;
}) {
  const { t } = useLocalization();
  const { Icon, tone, name } = issueStates[issueDisplayState(issue)];
  return decorative ? (
    <span className={`forge-icon forge-${tone}`}>
      <Icon size={size} />
    </span>
  ) : (
    <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)} data-hint={t(name)}>
      <Icon size={size} />
    </span>
  );
}

export function Label({ label, onClick }: { label: ForgeLabel; onClick?(): void }) {
  const style: CSSProperties = { '--label': `#${label.color}` };
  return onClick ? (
    <button
      className="forge-label clickable"
      style={style}
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label.name}
    </button>
  ) : (
    <span className="forge-label" style={style}>
      {label.name}
    </span>
  );
}

export function relativeTime(iso: string, { t, language }: ReturnType<typeof useLocalization>) {
  const date = new Date(iso);
  const seconds = (Date.now() - date.getTime()) / 1000;
  return seconds < 60
    ? t('justNow')
    : seconds < 3600
      ? t('minutesAgo', { count: Math.floor(seconds / 60) })
      : seconds < 86400
        ? t('hoursAgo', { count: Math.floor(seconds / 3600) })
        : seconds < 86400 * 30
          ? t('daysAgo', { count: Math.floor(seconds / 86400) })
          : date.toLocaleDateString(language);
}

export function RelativeTime({ iso }: { iso: string }) {
  const localization = useLocalization();
  return (
    <time dateTime={iso} data-hint={new Date(iso).toLocaleString(localization.language)}>
      {relativeTime(iso, localization)}
    </time>
  );
}

export function Progress({ closed, total }: SubIssueProgress) {
  const { t } = useLocalization();
  return (
    <span
      className="forge-progress"
      role="img"
      aria-label={t('subIssueProgress', { closed, total })}
      data-hint={t('subIssueProgress', { closed, total })}
    >
      <span className="forge-progress-bar">
        <span style={{ width: `${total ? (closed / total) * 100 : 0}%` }} />
      </span>
      {closed}/{total}
    </span>
  );
}

export function MoreOnForge({
  message,
  count,
  forge,
  url,
  className = '',
}: {
  message: 'moreSubIssues' | 'moreChecks';
  count: number;
  forge: string;
  url: string;
  className?: string;
}) {
  const { t } = useLocalization();
  return (
    <a className={`forge-more-link ${className}`} href={url} target="_blank" rel="noreferrer">
      {t(message, { count, forge })}
    </a>
  );
}

export function BlockedMark({ by, unlisted = 0 }: { by: { reference: string; title: string }[]; unlisted?: number }) {
  const { t } = useLocalization();
  const more = unlisted ? [t('moreBlockers', { count: unlisted })] : [];
  const names = [...by.map(blocker => blocker.reference), ...more].join(', ');
  return (
    <span
      className="forge-blocked"
      role="img"
      aria-label={t('blockedBy', { issues: names })}
      data-hint={[...by.map(blocker => `${blocker.reference} ${blocker.title}`), ...more].join('\n')}
    >
      <BlockedIcon size={12} />
      {names}
    </span>
  );
}

const pullRequestStates = {
  open: { Icon: GitPullRequestIcon, tone: 'open', name: 'pullRequestOpen', short: 'stateOpen' },
  draft: { Icon: GitPullRequestDraftIcon, tone: 'skipped', name: 'pullRequestDraft', short: 'stateDraft' },
  merged: { Icon: GitMergeIcon, tone: 'done', name: 'pullRequestMerged', short: 'stateMerged' },
  closed: { Icon: GitPullRequestClosedIcon, tone: 'failed', name: 'pullRequestClosed', short: 'stateClosed' },
} as const;

export function PullRequestIcon({
  state,
  size = 16,
  hint = true,
}: {
  state: PullRequestState;
  size?: number;
  hint?: boolean;
}) {
  const { t } = useLocalization();
  const { Icon, tone, name } = pullRequestStates[state];
  return (
    <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)} data-hint={hint ? t(name) : undefined}>
      <Icon size={size} />
    </span>
  );
}

export function PullRequestPill({ state }: { state: PullRequestState }) {
  const { t } = useLocalization();
  const { tone, short } = pullRequestStates[state];
  return (
    <span className={`forge-pill forge-bg-${tone}`}>
      <PullRequestIcon state={state} hint={false} />
      {t(short)}
    </span>
  );
}

const conclusions = {
  passed: { mark: '✓', name: 'checksPassed', tone: 'open' },
  failed: { mark: '✗', name: 'checksFailed', tone: 'failed' },
  pending: { mark: '●', name: 'checksPending', tone: 'pending' },
} as const;

export function OpenPullRequestChecks({ state, checks }: { state: PullRequestState; checks: ChecksConclusion }) {
  const { t } = useLocalization();
  if ((state !== 'open' && state !== 'draft') || checks === 'none') return null;
  const { mark, name, tone } = conclusions[checks];
  return (
    <span className={`forge-checks forge-${tone}`} role="img" aria-label={t(name)}>
      {mark} {t(name)}
    </span>
  );
}
