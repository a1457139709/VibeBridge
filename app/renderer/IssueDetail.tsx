import { useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { DesktopAPI } from '../shared/api';
import type { ProjectView } from '../shared/model';
import type { DispatchLocation } from '../shared/dispatch';
import type { WorkflowSettings } from '../shared/workflows';
import { platformDescriptions, repositoryItem, type IssueDetail, type MergeRequestReference,
  type RelatedIssue, type RepositoryItem, type RepositoryReference } from '../shared/code-hosting';
import { useLocalization } from './Localization';
import { IssueStateIcon } from './issue-icons';
import { CreatedAt, DetailFailureState, PlatformHtml, followLinks, useDetail } from './detail-parts';
import { CheckIcon, MergeRequestStateIcon } from './MergeRequestRow';
import { DispatchMenu, DispatchRecords, issueShortcutKeys, type DispatchMenuActions } from './Dispatch';
import type { Shortcuts } from '../shared/shortcuts';

/** How far ↑ and ↓ scroll the detail, in pixels. */
const scrollStep = 40;

/**
 * One issue's read-only detail, read from the platform each time it opens. Links to the bound
 * repository's issues and merge requests open in the sidebar; every other link goes to the
 * system browser. The issue is dispatched from here as from its list row, and its Dispatch
 * Records follow the snapshot.
 */
export function IssueDetailView({ project, repository, number, workflows, shortcuts, open, close, returnToList, locate, api = window.workbench }: {
  project: ProjectView; repository: RepositoryReference; number: number; workflows: WorkflowSettings; shortcuts: Shortcuts; open(item: RepositoryItem): void; close(): void;
  /** Closes the detail with focus on the issue's row. */
  returnToList(): void;
  /** Shows the panel a dispatch went to. */
  locate(location: DispatchLocation): void;
  api?: Pick<DesktopAPI, 'issueDetail' | 'dispatch'>;
}) {
  const projectId = project.id;
  const { t } = useLocalization();
  const section = useRef<HTMLElement>(null);
  // Focus enters the detail when it opens.
  useLayoutEffect(() => { section.current?.focus(); }, []);
  // Keys already handled, as the dispatch menu's and the shortcuts are, stay theirs.
  const keyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      section.current?.querySelector('.issue-detail-scroll')?.scrollBy({ top: event.key === 'ArrowUp' ? -scrollStep : scrollStep });
    } else if (event.key === 'ArrowRight' || event.key === 'Escape') returnToList();
    else return;
    event.preventDefault();
  };
  const state = useDetail<IssueDetail>(() => api.issueDetail(projectId, number).then(result => result.ok ? { ok: true as const, item: result.issue } : result), [projectId, number]);
  const menu = useRef<DispatchMenuActions>(null);
  const platform = platformDescriptions[repository.platform];
  const openReference = (reference: RelatedIssue) => {
    if (reference.repository.toLowerCase() === repository.path.toLowerCase()) open({ kind: 'issue', number: reference.number });
    else window.open(reference.url, '_blank');
  };
  const openMergeRequest = (request: MergeRequestReference) => {
    const item = repositoryItem(repository, request.url);
    if (item) open(item); else window.open(request.url, '_blank');
  };
  const issue = state.item?.number === number ? state.item : undefined;
  const records = project.dispatches.filter(record => record.issue === number);
  const shortcutKeys = issue && issueShortcutKeys({ issue, records, shortcuts, menu, locate });
  return <section ref={section} tabIndex={-1} className="issue-detail" aria-label={t('issueDetail', { number })} onClick={followLinks(repository, open)}
    onKeyDown={event => { shortcutKeys?.(event); keyDown(event); }}>
    <header className="issue-detail-bar">
      <span className="issue-detail-crumb">{t('issueDetail', { number })}</span>
      {issue && <a href={issue.url} target="_blank" rel="noreferrer">{t('openOnPlatform', { platform: platform.name })}</a>}
      <button className="issue-detail-close" aria-label={t('closeDetail')} onClick={close}>×</button>
    </header>
    <div className="issue-detail-scroll">
      {state.failure && !state.loading ? <DetailFailureState failure={state.failure} number={number} retry={state.read} />
        : !issue ? <p className="issue-detail-loading" role="status">{t('loadingIssue')}</p>
        : <>
          <h2 className="issue-detail-title">{issue.title} <span className="issue-row-number">#{issue.number}</span></h2>
          <div className="issue-detail-head">
            <IssueStateIcon issue={issue} />
            {issue.labels.map(label =>
              <span key={label.name} className="issue-label" style={{ '--label-color': `#${label.color}` } as CSSProperties}>{label.name}</span>)}
            <DispatchMenu ref={menu} issue={issue} project={project} workflows={workflows} dispatch={request => api.dispatch(projectId, request)} filled={locate} />
          </div>
          <div className="issue-detail-meta">
            {issue.author && <span className="issue-detail-author">{issue.author}</span>}
            <CreatedAt at={issue.createdAt} />
            <span>{t(issue.commentCount === 1 ? 'commentCountOne' : 'commentCount', { count: issue.commentCount })}</span>
            {!!issue.assignees.length && <span>{t('assignees')} <span>{issue.assignees.join(', ')}</span></span>}
          </div>
          <DispatchRecords issue={issue} records={records} locate={locate} />
          <RelationGraph issue={issue} repository={repository} open={openReference} />
          <ClosingMergeRequests mergeRequests={issue.closingMergeRequests} open={openMergeRequest} />
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

type RelationKind = 'parent' | 'blockedBy' | 'subIssue' | 'blocking';
const relationNames = { parent: 'relationParent', blockedBy: 'relationBlockedBy', subIssue: 'relationSubIssue', blocking: 'relationBlocking' } as const;
const rowHeight = 28;

/**
 * Issues only: what the issue belongs to and what blocks it on the left, the issue in the
 * middle, its sub-issues and what it blocks on the right. A relation the platform does not
 * declare is not drawn; with nothing to draw there is no graph.
 */
function RelationGraph({ issue, repository, open }: { issue: IssueDetail; repository: RepositoryReference; open(reference: RelatedIssue): void }) {
  const { t } = useLocalization();
  const capabilities = platformDescriptions[repository.platform].capabilities;
  const subIssues = capabilities.includes('subIssues');
  const blocking = capabilities.includes('nativeBlocking');
  const node = (kind: RelationKind) => (reference: RelatedIssue) => ({ kind, reference });
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

/** Merge requests that close the issue when merged; each opens its own detail. */
function ClosingMergeRequests({ mergeRequests, open }: { mergeRequests: MergeRequestReference[]; open(request: MergeRequestReference): void }) {
  const { t } = useLocalization();
  if (!mergeRequests.length) return null;
  return <section className="closing-merge-requests">
    <h3>{t('closingMergeRequests')}</h3>
    <ul aria-label={t('closingMergeRequests')}>
      {mergeRequests.map(request => <li key={request.number}
        className={`closing-merge-request merge-request-${request.state === 'open' && request.draft ? 'draft' : request.state}`}>
        <button aria-label={`#${request.number} ${request.title}`} title={request.title} onClick={() => open(request)}>
          <MergeRequestStateIcon request={request} />
          <span className="issue-row-number">#{request.number}</span>
          <span className="relation-title">{request.title}</span>
          {request.checks && <CheckIcon conclusion={request.checks} />}
        </button>
      </li>)}
    </ul>
  </section>;
}
