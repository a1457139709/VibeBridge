import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { DesktopAPI } from '../shared/api';
import { platformDescriptions, repositoryItem, type ChecksVerdict, type IssueDetail, type IssueDetailResult, type IssueReference,
  type MergeRequestReference, type MergeRequestState, type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { allowedHtml } from './platform-html';
import { IssueStateIcon, relativeTime } from './IssueLists';

type Failure = Extract<IssueDetailResult, { ok: false }> | { ok: false; error: string };

/**
 * One issue's read-only detail, read from the platform each time it opens. Links to the bound
 * repository's issues open here; every other link, and merge requests until their detail
 * exists, go to the system browser.
 */
export function IssueDetailView({ projectId, repository, number, openIssue, close, api = window.workbench }: {
  projectId: string; repository: RepositoryReference; number: number; openIssue(number: number): void; close(): void;
  api?: Pick<DesktopAPI, 'issueDetail'>;
}) {
  const { t } = useLocalization();
  const [state, setState] = useState<{ issue?: IssueDetail; failure?: Failure; loading: boolean }>({ loading: true });
  const latest = useRef(0);
  const read = () => {
    const request = ++latest.current;
    setState(current => ({ ...current, loading: true }));
    api.issueDetail(projectId, number).then(result => result, (error: Error) => ({ ok: false, error: error.message }) as const).then(result => {
      if (request !== latest.current) return;
      setState(result.ok ? { issue: result.issue, loading: false } : { failure: result, loading: false });
    });
  };
  useEffect(() => { setState({ loading: true }); read(); }, [projectId, number]);
  const platform = platformDescriptions[repository.platform];
  const follow = (event: MouseEvent) => {
    // Only links inside the platform's HTML: the header's link opens the issue on the platform.
    const link = (event.target as Element).closest?.('.platform-html a[href]');
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute('href')!;
    const item = repositoryItem(repository, href);
    if (item?.kind === 'issue') openIssue(item.number);
    else window.open(href, '_blank');
  };
  const openReference = (reference: IssueReference) => {
    if (reference.repository.toLowerCase() === repository.path.toLowerCase()) openIssue(reference.number);
    else window.open(reference.url, '_blank');
  };
  const issue = state.issue?.number === number ? state.issue : undefined;
  return <section className="issue-detail" aria-label={t('issueDetail', { number })} onClick={follow}>
    <header className="issue-detail-bar">
      <span className="issue-detail-crumb">{t('issueDetail', { number })}</span>
      {issue && <a href={issue.url} target="_blank" rel="noreferrer">{t('openOnPlatform', { platform: platform.name })}</a>}
      <button className="issue-detail-close" aria-label={t('closeDetail')} onClick={close}>×</button>
    </header>
    <div className="issue-detail-scroll">
      {state.failure && !state.loading ? <DetailFailure failure={state.failure} number={number} retry={read} />
        : !issue ? <p className="issue-detail-loading" role="status">{t('loadingIssue')}</p>
        : <>
          <h2 className="issue-detail-title">{issue.title} <span className="issue-row-number">#{issue.number}</span></h2>
          <div className="issue-detail-meta">
            <IssueStateIcon issue={issue} />
            {issue.author && <span className="issue-detail-author">{issue.author}</span>}
            <CreatedAt at={issue.createdAt} />
            <span>{t(issue.commentCount === 1 ? 'commentCountOne' : 'commentCount', { count: issue.commentCount })}</span>
            {!!issue.assignees.length && <span>{t('assignees')} <span>{issue.assignees.join(', ')}</span></span>}
          </div>
          {!!issue.labels.length && <div className="issue-detail-labels">{issue.labels.map(label =>
            <span key={label.name} className="issue-label" style={{ '--label-color': `#${label.color}` } as CSSProperties}>{label.name}</span>)}</div>}
          <RelationGraph issue={issue} repository={repository} open={openReference} />
          <ClosingMergeRequests mergeRequests={issue.closingMergeRequests} />
          <article className="issue-detail-card">
            <header>{issue.author && <b>{issue.author}</b>} <CreatedAt at={issue.createdAt} /></header>
            <PlatformHtml html={issue.body} />
          </article>
          {issue.comments.map((comment, index) => <article key={index} className="issue-detail-card">
            <header>{comment.author && <b>{comment.author}</b>} <CreatedAt at={comment.createdAt} /></header>
            <PlatformHtml html={comment.body} />
          </article>)}
        </>}
    </div>
  </section>;
}

function CreatedAt({ at }: { at: string }) {
  const { language } = useLocalization();
  const date = new Date(at);
  return <time dateTime={at} title={date.toLocaleString(language)}>{relativeTime(date, language)}</time>;
}

function PlatformHtml({ html }: { html: string }) {
  return <div className="platform-html" dangerouslySetInnerHTML={{ __html: allowedHtml(html) }} />;
}

function DetailFailure({ failure, number, retry }: { failure: Failure; number: number; retry(): void }) {
  const { t, text } = useLocalization();
  const reason = 'error' in failure ? text(failure.error)
    : failure.failure.kind === 'notInstalled' ? t('platformCliMissing', { platform: failure.failure.platform.name })
    : failure.failure.kind === 'signedOut' ? t('platformSignInNeeded', { platform: failure.failure.platform.name })
    : failure.failure.kind === 'unreachable' ? t('issueUnreachable', { number })
    : t('listReadFailed', { platform: failure.failure.platform.name, reason: failure.failure.output || failure.failure.kind });
  return <div className="issue-sidebar-state" role="alert"><p>{reason}</p><button onClick={retry}>{t('retry')}</button></div>;
}

type RelationKind = 'parent' | 'blockedBy' | 'subIssue' | 'blocking';
const relationNames = { parent: 'relationParent', blockedBy: 'relationBlockedBy', subIssue: 'relationSubIssue', blocking: 'relationBlocking' } as const;
const rowHeight = 28;

/**
 * Issues only: what the issue belongs to and what blocks it on the left, the issue in the
 * middle, its sub-issues and what it blocks on the right. A relation the platform does not
 * declare is not drawn; with nothing to draw there is no graph.
 */
function RelationGraph({ issue, repository, open }: { issue: IssueDetail; repository: RepositoryReference; open(reference: IssueReference): void }) {
  const { t } = useLocalization();
  const capabilities = platformDescriptions[repository.platform].capabilities;
  const subIssues = capabilities.includes('subIssues');
  const blocking = capabilities.includes('nativeBlocking');
  const node = (kind: RelationKind) => (reference: IssueReference) => ({ kind, reference });
  const left = [...(subIssues && issue.parent ? [node('parent')(issue.parent)] : []), ...(blocking ? issue.blockedBy.map(node('blockedBy')) : [])];
  const right = [...(subIssues ? issue.subIssues.map(node('subIssue')) : []), ...(blocking ? issue.blocking.map(node('blocking')) : [])];
  if (!left.length && !right.length) return null;
  const rows = Math.max(left.length, right.length, 1);
  const height = rows * rowHeight;
  const centre = (index: number, count: number) => (index + (rows - count) / 2 + 0.5) * rowHeight;
  const edge = (kind: RelationKind) => kind === 'parent' || kind === 'subIssue' ? 'relation-edge-parent' : 'relation-edge-blocks';
  const column = (nodes: typeof left, side: 'left' | 'right') => nodes.map(({ kind, reference }, index) => {
    const label = `${t(relationNames[kind])}: #${reference.number} ${reference.title}`;
    const own = reference.repository.toLowerCase() === repository.path.toLowerCase();
    return <button key={`${kind}:${reference.repository}#${reference.number}`} className={`relation-node relation-node-${side} relation-${kind}`} aria-label={label} title={label}
      style={{ top: centre(index, nodes.length) - rowHeight / 2 + 2 }} onClick={() => open(reference)}>
      <IssueStateIcon issue={reference} />
      <span className="issue-row-number">{own ? '' : reference.repository}#{reference.number}</span>
      <span className="relation-title">{reference.title}</span>
    </button>;
  });
  const middle = centre(0, 1);
  return <div className="relation-graph" role="group" aria-label={t('relations')} style={{ height }}>
    <svg aria-hidden="true" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none">
      {left.map(({ kind }, index) => <path key={`l${index}`} className={`relation-edge ${edge(kind)}`}
        d={`M34 ${centre(index, left.length)} C36 ${centre(index, left.length)} 36 ${middle} 38 ${middle}`} />)}
      {right.map(({ kind }, index) => <path key={`r${index}`} className={`relation-edge ${edge(kind)}`}
        d={`M62 ${middle} C64 ${middle} 64 ${centre(index, right.length)} 66 ${centre(index, right.length)}`} />)}
    </svg>
    {column(left, 'left')}
    <div className="relation-node relation-self" style={{ top: middle - rowHeight / 2 + 2 }}>
      <IssueStateIcon issue={issue} /><span className="issue-row-number">#{issue.number}</span>
    </div>
    {column(right, 'right')}
  </div>;
}

const mergeRequestStates = { open: 'mergeRequestOpen', draft: 'mergeRequestDraft', merged: 'mergeRequestMerged', closed: 'mergeRequestClosed' } as const;
const verdicts = { passing: ['✓', 'checksPassing'], failing: ['✗', 'checksFailing'], pending: ['●', 'checksPending'] } as const;

/** Merge requests that close the issue when merged. Opening one belongs to the merge request detail. */
function ClosingMergeRequests({ mergeRequests }: { mergeRequests: MergeRequestReference[] }) {
  const { t } = useLocalization();
  if (!mergeRequests.length) return null;
  return <section className="closing-merge-requests">
    <h3>{t('closingMergeRequests')}</h3>
    <ul aria-label={t('closingMergeRequests')}>
      {mergeRequests.map(request => <li key={request.number} className={`closing-merge-request merge-request-${request.state}`}>
        <MergeRequestIcon state={request.state} />
        <span className="issue-row-number">#{request.number}</span>
        <span className="relation-title">{request.title}</span>
        {request.checks && <ChecksMark verdict={request.checks} />}
      </li>)}
    </ul>
  </section>;
}

function ChecksMark({ verdict }: { verdict: ChecksVerdict }) {
  const { t } = useLocalization();
  const [mark, name] = verdicts[verdict];
  return <span className={`checks-mark checks-${verdict}`} role="img" aria-label={t(name)}>{mark}</span>;
}

// GitHub's octicon git-pull-request.
function MergeRequestIcon({ state }: { state: MergeRequestState }) {
  const { t } = useLocalization();
  return <svg className="merge-request-icon" role="img" aria-label={t(mergeRequestStates[state])} viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
    <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
  </svg>;
}
