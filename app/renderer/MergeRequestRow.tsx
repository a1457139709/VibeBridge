import type { CheckConclusion, MergeRequestSummary } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { LabelButtons, relativeTime, type DetailOpening } from './list-row-parts';

/** A merge request row: no actions, since dispatch starts from issues. Clicking it outside its labels opens its detail. */
export function MergeRequestRow({ request, addLabel, detail }: { request: MergeRequestSummary; addLabel(name: string): void; detail: DetailOpening }) {
  const { t, language } = useLocalization();
  const created = new Date(request.createdAt);
  return <li aria-label={`#${request.number} ${request.title}`} aria-current={detail.opened === request.number || undefined}>
    <div className="issue-row" onClick={event => { if (!(event.target as Element).closest('button, a')) detail.open(request.number); }}>
      <MergeRequestStateIcon request={request} />
      <div className="issue-row-main">
        <div className="issue-row-title">{request.title}</div>
        <div className="issue-row-meta">
          <span className="issue-row-number">#{request.number}</span>
          <time dateTime={request.createdAt} title={created.toLocaleString(language)}>{relativeTime(created, language)}</time>
          {/* GitHub names a deleted account ghost. */}
          <span className="issue-row-author">{request.author ?? t('deletedAuthor')}</span>
          {request.checks && <CheckIcon conclusion={request.checks} />}
          <LabelButtons labels={request.labels} addLabel={addLabel} />
        </div>
      </div>
    </div>
  </li>;
}

// GitHub's own octicons: git-pull-request, git-pull-request-draft, git-merge and git-pull-request-closed.
const mergeRequestIcons = {
  open: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
  draft: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
  merged: 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
  closed: 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
};

export function MergeRequestStateIcon({ request }: { request: Pick<MergeRequestSummary, 'state' | 'draft'> }) {
  const { t } = useLocalization();
  const [icon, name] = request.state === 'merged' ? ['merged', t('mergeRequestMerged')] as const
    : request.state === 'closed' ? ['closed', t('mergeRequestClosed')] as const
    : request.draft ? ['draft', t('mergeRequestDraft')] as const
    : ['open', t('mergeRequestOpen')] as const;
  return <svg className={`issue-state merge-request-state-${icon}`} role="img" aria-label={name} viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
    <path d={mergeRequestIcons[icon]} />
  </svg>;
}

/** ✓ / ✗ / ● as GitHub marks a commit's checks. */
export function CheckIcon({ conclusion }: { conclusion: CheckConclusion }) {
  const { t } = useLocalization();
  const [mark, name] = conclusion === 'passing' ? ['✓', t('checksPassed')] : conclusion === 'failing' ? ['✗', t('checksFailed')] : ['●', t('checksInProgress')];
  return <span className={`merge-request-checks merge-request-checks-${conclusion}`} role="img" aria-label={name} title={name}>{mark}</span>;
}
