import type { ReactNode } from 'react';
import type { DesktopAPI } from '../shared/api';
import { platformDescriptions, type Check, type IssueComment, type MergeRequestDetail, type MergeRequestReview, type MergeState,
  type RepositoryItem, type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { CommentCard, ConversationCard, DetailBar, DetailFailureState, Labels, PlatformHtml, followLinks, openRelatedIssue, relatedIssueNumber, useDetail } from './detail-parts';
import { CheckIcon, MergeRequestStateIcon } from './MergeRequestRow';
import { MergeRequestActions, type DirectActionHost } from './DirectActions';
import './merge-request-detail.css';

/**
 * One merge request's read-only detail, read from the platform each time it opens: its header,
 * its conversation in time order and, while it is open, the merge area. It shows no diff, change
 * counts or reviewers, and approves nothing.
 */
export function MergeRequestDetailView({ projectId, repository, number, open, close, host, api = window.workbench }: {
  projectId: string; repository: RepositoryReference; number: number; open(item: RepositoryItem): void; close(): void; host: DirectActionHost;
  api?: Pick<DesktopAPI, 'mergeRequestDetail' | 'directAction'>;
}) {
  const { t } = useLocalization();
  const state = useDetail<MergeRequestDetail>(() => api.mergeRequestDetail(projectId, number)
    .then(result => result.ok ? { ok: true as const, item: result.mergeRequest } : result), [projectId, number]);
  const request = state.item?.number === number ? state.item : undefined;
  const actions = (shown: MergeRequestDetail) => <MergeRequestActions projectId={projectId} repository={repository} request={shown}
    host={{ ...host, changed: () => { state.read(); host.changed(); } }} api={api} />;
  return <section className="issue-detail" aria-label={t('mergeRequestDetail', { number })} onClick={followLinks(repository, open)}>
    <DetailBar label={t('mergeRequestDetail', { number })} url={request?.url} repository={repository} close={close} />
    <div className="issue-detail-scroll">
      {state.failure && !state.loading ? <DetailFailureState failure={state.failure} number={number} retry={state.read} />
        : !request ? <p className="issue-detail-loading" role="status">{t('loadingMergeRequest')}</p>
        : <>
          <Header request={request} repository={repository} open={open} />
          <Conversation request={request} />
          {request.state === 'open' ? <MergeArea request={request} merge={request.merge} repository={repository}>{actions(request)}</MergeArea> : actions(request)}
        </>}
    </div>
  </section>;
}

function Header({ request, repository, open }: { request: MergeRequestDetail; repository: RepositoryReference; open(item: RepositoryItem): void }) {
  const { t } = useLocalization();
  const openIssue = openRelatedIssue(repository, open);
  return <div className="merge-request-header">
    <h2 className="issue-detail-title">{request.title} <span className="issue-row-number">#{request.number}</span></h2>
    <div className="issue-detail-meta">
      <MergeRequestStateIcon request={request} />
      <code className="merge-request-branches">{request.head} → {request.base}</code>
      <a href={request.changesUrl} target="_blank" rel="noreferrer">{t('viewChanges', { platform: platformDescriptions[repository.platform].name })}</a>
    </div>
    <Labels labels={request.labels} />
    {!!request.closingIssues.length && <div className="merge-request-closes" role="group" aria-label={t('closesWhenMerged')}>
      <span>{t('closesWhenMerged')}</span>
      {request.closingIssues.map(issue => <button key={`${issue.repository.path}#${issue.number}`} aria-label={`#${issue.number} ${issue.title}`} title={issue.title}
        onClick={() => openIssue(issue)}>{relatedIssueNumber(issue, repository)}</button>)}
    </div>}
  </div>;
}

const reviewNames = {
  approved: 'reviewApproved', changesRequested: 'reviewChangesRequested', commented: 'reviewCommented', dismissed: 'reviewDismissed',
} as const;

/** The body first, then comments and review summaries as they happened. */
function Conversation({ request }: { request: MergeRequestDetail }) {
  const { t } = useLocalization();
  const entries: ({ at: string; comment: IssueComment } | { at: string; review: MergeRequestReview })[] = [
    ...request.comments.map(comment => ({ at: comment.createdAt, comment })), ...request.reviews.map(review => ({ at: review.submittedAt, review })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return <>
    <CommentCard author={request.author} at={request.createdAt} body={request.body} />
    {entries.map((entry, index) => 'comment' in entry
      ? <CommentCard key={index} author={entry.comment.author} at={entry.at} body={entry.comment.body} />
      : <ConversationCard key={index} className={`merge-request-review review-${entry.review.state}`} author={entry.review.author} at={entry.at}
        note={<span className="review-state">{t(reviewNames[entry.review.state])}</span>}>
        {entry.review.body && <PlatformHtml html={entry.review.body} />}
        {entry.review.codeComments > 0 && <a className="review-code-comments" href={entry.review.url} target="_blank" rel="noreferrer">
          {entry.review.codeComments === 1 ? t('codeCommentsOne') : t('codeComments', { count: entry.review.codeComments })}</a>}
      </ConversationCard>)}
  </>;
}

const decisionNames = { approved: 'decisionApproved', changesRequested: 'decisionChangesRequested', reviewRequired: 'decisionReviewRequired' } as const;

/** What stands between the merge request and merging, in order: review, checks, conflicts, draft, then the merge and close buttons. */
function MergeArea({ request, merge, repository, children }: { request: MergeRequestDetail; merge: MergeState; repository: RepositoryReference; children: ReactNode }) {
  const { t } = useLocalization();
  const platform = platformDescriptions[repository.platform];
  const required = platform.capabilities.includes('requiredChecks');
  const counts = { failing: 0, pending: 0, passing: 0 };
  for (const check of merge.checks) counts[check.conclusion]++;
  const summary = [counts.failing && t('checksFailing', { count: counts.failing }), counts.pending && t('checksPending', { count: counts.pending }),
    counts.passing && t('checksPassing', { count: counts.passing })].filter(Boolean).join(', ');
  const attention = [...merge.checks.filter(check => check.conclusion === 'failing'), ...merge.checks.filter(check => check.conclusion === 'pending')];
  const passed = merge.checks.filter(check => check.conclusion === 'passing');
  const item = (check: Check, index: number) => <li key={index} className={`merge-check merge-check-${check.conclusion}`}>
    <CheckIcon conclusion={check.conclusion} />
    {check.url ? <a href={check.url} target="_blank" rel="noreferrer" title={t('checkLog', { platform: platform.name })}>{check.name}</a> : <span>{check.name}</span>}
    {required && check.required && <span className="merge-check-required">{t('requiredCheck')}</span>}
  </li>;
  return <section className="merge-area" aria-label={t('mergeStatus')}>
    {merge.review && <p className={`merge-review merge-review-${merge.review}`}>{t(decisionNames[merge.review])}</p>}
    {!!merge.checks.length && <div className="merge-checks">
      <p>{summary}</p>
      {!!attention.length && <ul aria-label={t('checksNeedingAttention')}>{attention.map(item)}</ul>}
      {!!passed.length && <details>
        <summary>{t('passedChecks', { count: passed.length })}</summary>
        <ul aria-label={t('passedChecks', { count: passed.length })}>{passed.map(item)}</ul>
      </details>}
    </div>}
    {merge.conflicting && <p className="merge-conflicts">{t('mergeConflicts')}</p>}
    {request.draft && <p className="merge-draft">{t('mergeDraft')}</p>}
    {children}
  </section>;
}
