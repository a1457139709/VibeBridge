import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon } from '@primer/octicons-react';
import { useLocalization } from './Localization';
import { detail as reason } from '../shared/messages';
import { filterForgeHtml } from '../shared/forge-html';
import type { IssueDetail, IssueDetailResult, IssueReference, PullRequestReference, RepositoryReference } from '../shared/forge';
import type { ProjectView } from '../shared/model';
import { BlockedMark, IssueIcon, issueState, issueStates, Label, Progress, RelativeTime } from './ForgeDisplay';

interface Props {
  project: ProjectView & { repository: RepositoryReference };
  number: number;
  width: number;
  /** Starts dragging the detail's left edge. */
  resize(event: ReactPointerEvent<HTMLDivElement>): void;
  canBack: boolean;
  back(): void;
  close(): void;
  /** Opens an issue of the bound repository in this detail. */
  open(number: number): void;
}

/** The read-only detail of one issue of the bound repository, opening leftwards from the sidebar's edge. One column,
 * like the forge: the parent, title, state and labels, the relation graph, the pull requests that close it, then the
 * body, sub-issues and comments in the forge's own rendering, filtered. Issue links of the bound repository open here;
 * every other link opens in the browser. */
export function IssueDetailPane({ project, number, width, resize, canBack, back, close, open }: Props) {
  const { t, text } = useLocalization();
  const [loaded, setLoaded] = useState<{ number: number; result: IssueDetailResult } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    // A failure outside the forge (the request itself) is shown like a transient one, with its reason and Retry.
    window.workbench.issueDetail(project.id, number)
      .catch((error: Error): IssueDetailResult => ({ ok: false, failure: { kind: 'transient', detail: text(error.message), forge: project.forge } }))
      .then(result => { if (current) setLoaded({ number, result }); });
    return () => { current = false; };
  }, [project.id, number, attempt]);
  useLayoutEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); }, [number]);
  const result = loaded?.number === number ? loaded.result : null;
  const issue = result?.ok ? result.issue : null;
  const retry = () => { setLoaded(null); setAttempt(count => count + 1); };

  return <section className="forge-detail" aria-label={t('issueDetail')} style={{ width }}>
    <div className="forge-detail-resize" role="separator" aria-orientation="vertical" aria-label={t('resizeDetail')} onPointerDown={resize} />
    <header className="forge-detail-bar">
      <button aria-label={t('detailBack')} data-hint={t('detailBack')} disabled={!canBack} onClick={back}>‹</button>
      <span className="forge-detail-crumb">{t('issueCrumb', { number })}</span>
      <span className="forge-spacer" />
      {issue && <a href={issue.url} target="_blank" rel="noreferrer">{t('openOnForge', { forge: project.forge.name })}</a>}
      <button aria-label={t('closeDetail')} data-hint={t('closeDetail')} onClick={close}>×</button>
    </header>
    <div className="forge-detail-scroll" ref={scroller} tabIndex={-1}>
      {!result ? <p className="forge-empty">{t('loadingIssue', { number })}</p>
        : !result.ok ? <div className="forge-sidebar-state">
          <p>{t('issueLoadFailed', { number, reason: reason(result.failure.detail || result.failure.kind) })}</p>
          <button onClick={retry}>{t('retry')}</button>
        </div>
        : <IssueDocument project={project} issue={result.issue} open={open} />}
    </div>
  </section>;
}

function IssueDocument({ project, issue, open }: { project: Props['project']; issue: IssueDetail; open(number: number): void }) {
  const { t } = useLocalization();
  const { capabilities } = project;
  /** The issue number a link to `url` names when it is an issue of the bound repository, else null. */
  const ownIssue = (url: string) => {
    // Repository paths in a forge's URLs may differ in case from the bound one.
    if (!url.toLowerCase().startsWith(issue.issueLinks.toLowerCase())) return null;
    const match = /^(\d+)(?:[?#].*)?$/.exec(url.slice(issue.issueLinks.length));
    return match ? Number(match[1]) : null;
  };
  const follow = (reference: IssueReference) => {
    const number = ownIssue(reference.url);
    if (number === null) window.open(reference.url, '_blank');
    else open(number);
  };
  // Links in the forge's HTML: an issue of the bound repository opens here; the filter sends the rest to the browser.
  const followLink = (event: MouseEvent) => {
    const link = (event.target as Element).closest('a');
    const number = link?.getAttribute('href') ? ownIssue(link.getAttribute('href')!) : null;
    if (number === null) return;
    event.preventDefault();
    open(number);
  };
  const openBlockers = issue.blockedBy.filter(blocker => blocker.state === 'open');
  const subIssues = capabilities.subIssues ? issue.subIssues : [];
  const parent = capabilities.subIssues ? issue.parent : null;
  return <div className="forge-doc" onClick={followLink}>
    {parent && <button className="forge-parent" onClick={() => follow(parent)}>
      <IssueIcon issue={parent} size={12} /><span className="forge-ellipsis">{parent.title}</span><span className="forge-row-number">#{parent.number}</span>
      {!!parent.progress.total && <Progress {...parent.progress} />}
    </button>}
    <h2>{issue.title} <span className="forge-row-number">#{issue.number}</span></h2>
    <div className="forge-doc-head">
      <StatePill issue={issue} />
      {issue.labels.map(label => <Label key={label.name} label={label} />)}
      <span className="forge-spacer" />
      {capabilities.blocking && issue.state === 'open' && !!openBlockers.length && <BlockedMark by={openBlockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }))} />}
    </div>
    <div className="forge-doc-meta">
      <b>{issue.author ?? t('deletedAccount')}</b> {t('issueOpened')} <RelativeTime iso={issue.createdAt} />
      {' · '}{issue.commentCount === 1 ? t('oneComment') : t('commentCount', { count: issue.commentCount })}
      {!!issue.assignees.length && <>{' · '}{t('assigneeList', { names: issue.assignees.join(', ') })}</>}
    </div>
    {capabilities.blocking && <RelationGraph issue={issue} blockers={openBlockers} follow={follow} />}
    {!!issue.closingPullRequests.length && <ClosingPullRequests pulls={issue.closingPullRequests} />}
    <div className="forge-doc-main">
      <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
      {!!subIssues.length && <section className="forge-box" aria-label={t('subIssues')}>
        <header>{t('subIssues')} <Progress closed={subIssues.filter(sub => sub.state === 'closed').length} total={subIssues.length} /></header>
        {subIssues.map(sub => <button key={sub.number} className={`forge-ref ${sub.state === 'closed' ? 'closed' : ''}`} data-hint={sub.title} onClick={() => follow(sub)}>
          <IssueIcon issue={sub} /><span className="forge-ellipsis">{sub.title}</span><span className="forge-row-number">#{sub.number}</span></button>)}
      </section>}
      {issue.comments.map((comment, index) => <Post key={index} {...comment} />)}
      {issue.commentCount > issue.comments.length && <a className="forge-more-comments" href={issue.url} target="_blank" rel="noreferrer">
        {t('moreComments', { count: issue.commentCount, forge: project.forge.name })}</a>}
    </div>
  </div>;
}

/** A body or comment: who wrote it and when, then the forge's HTML through the filter. */
function Post({ author, createdAt, html }: { author: string | null; createdAt: string; html: string }) {
  const { t } = useLocalization();
  const filtered = useMemo(() => filterForgeHtml(html), [html]);
  return <article className="forge-card">
    <header><b>{author ?? t('deletedAccount')}</b> <RelativeTime iso={createdAt} /></header>
    {filtered.trim() ? <div className="forge-markdown" dangerouslySetInnerHTML={{ __html: filtered }} /> : <p className="forge-markdown-empty">{t('noDescription')}</p>}
  </article>;
}

function StatePill({ issue }: { issue: IssueDetail }) {
  const { t } = useLocalization();
  const { tone, short } = issueStates[issueState(issue)];
  return <span className={`forge-pill forge-bg-${tone}`}><IssueIcon issue={issue} decorative />{t(short)}</span>;
}

/** The small graph at the top of the detail, only of issues and only of live blocking: the open blockers on the left, the issue
 * in the middle, and on the right the open issues it still blocks while it is open. Nothing to draw, no graph. */
function RelationGraph({ issue, blockers: left, follow }: { issue: IssueDetail; blockers: IssueReference[]; follow(reference: IssueReference): void }) {
  const right = issue.state === 'open' ? issue.blocking.filter(blocked => blocked.state === 'open') : [];
  if (!left.length && !right.length) return null;
  return <Graph issue={issue} left={left} right={right} follow={follow} />;
}

const rowHeight = 28, headHeight = 20, padding = 8, gap = 28;
function Graph({ issue, left, right, follow }: { issue: IssueDetail; left: IssueReference[]; right: IssueReference[]; follow(reference: IssueReference): void }) {
  const { t } = useLocalization();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  const columns: { name: 'blockedBy' | 'self' | 'blocking'; head: string; nodes: IssueReference[] }[] = [
    { name: 'blockedBy', head: t('blockedByColumn'), nodes: left }, { name: 'self', head: t('thisIssue'), nodes: [issue] },
    { name: 'blocking', head: t('blockingColumn'), nodes: right }];
  const columnWidth = (width - padding * 2 - gap * 2) / 3;
  const rows = Math.max(left.length, right.length, 1);
  // Shorter columns are centred against the tallest.
  const at = (column: number, row: number) => ({ x: padding + column * (columnWidth + gap),
    y: headHeight + (row + (rows - columns[column].nodes.length) / 2) * rowHeight });
  const height = headHeight + rows * rowHeight + 4;
  const edge = (from: { x: number; y: number }, to: { x: number; y: number }, key: string) => {
    const x1 = from.x + columnWidth, y1 = from.y + rowHeight / 2 - 2, x2 = to.x, y2 = to.y + rowHeight / 2 - 2, middle = (x1 + x2) / 2;
    return <path key={key} className="forge-edge" d={`M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2 - 1} ${y2}`} markerEnd="url(#forge-arrow)" />;
  };
  const self = at(1, 0);
  return <div className="forge-graph" role="group" aria-label={t('relations')} ref={host} style={{ height }}>
    {columns.map((column, index) => <span key={column.name} className="forge-graph-head" style={{ left: padding + index * (columnWidth + gap), width: columnWidth }}>{column.head}</span>)}
    <svg width={width} height={height} aria-hidden>
      <defs><marker id="forge-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" /></marker></defs>
      {left.map((blocker, row) => edge(at(0, row), self, `left-${blocker.number}`))}
      {right.map((blocked, row) => edge(self, at(2, row), `right-${blocked.number}`))}
    </svg>
    {columns.map((column, index) => column.nodes.map((node, row) => {
      const { x, y } = at(index, row);
      const content = <><IssueIcon issue={node} size={12} decorative /><span className="forge-row-number">#{node.number}</span><span className="forge-ellipsis">{node.title}</span></>;
      const style = { left: x, top: y, width: columnWidth };
      return column.name === 'self'
        ? <div key={node.number} className="forge-node self" data-column={column.name} style={style}>{content}</div>
        : <button key={node.number} className="forge-node" data-column={column.name} style={style} data-hint={`#${node.number} ${node.title}`}
          onClick={() => follow(node)}>{content}</button>;
    }))}
  </div>;
}

/** Each checks conclusion's mark, name and colour. */
const conclusions = {
  passed: { mark: '✓', name: 'checksPassed', tone: 'open' },
  failed: { mark: '✗', name: 'checksFailed', tone: 'failed' },
  pending: { mark: '●', name: 'checksPending', tone: 'pending' },
} as const;

/** The pull requests that close the issue on merge, closed ones included, apart from the issue graph and drawn as pull
 * requests. An open or draft one shows its checks conclusion. Each opens in the browser. */
function ClosingPullRequests({ pulls }: { pulls: PullRequestReference[] }) {
  const { t } = useLocalization();
  return <section className="forge-closing-pulls" aria-label={t('closingPullRequests')}>
    <header>{t('closingPullRequests')}</header>
    <ul>{pulls.map(pull => {
      const checks = (pull.state === 'open' || pull.state === 'draft') && pull.checks !== 'none' ? conclusions[pull.checks] : null;
      return <li key={pull.number}><a className="forge-closing-pull" href={pull.url} target="_blank" rel="noreferrer" data-hint={pull.title}>
        <PullRequestIcon pull={pull} /><span className="forge-row-number">#{pull.number}</span><span className="forge-ellipsis">{pull.title}</span>
        {checks && <span className={`forge-checks forge-${checks.tone}`}>{checks.mark} {t(checks.name)}</span>}
      </a></li>;
    })}</ul>
  </section>;
}

/** The forge's pull request octicons and colours: open green, draft grey, merged purple, closed red. */
const pullRequestStates = {
  open: { Icon: GitPullRequestIcon, tone: 'open', name: 'pullRequestOpen' },
  draft: { Icon: GitPullRequestDraftIcon, tone: 'skipped', name: 'pullRequestDraft' },
  merged: { Icon: GitMergeIcon, tone: 'done', name: 'pullRequestMerged' },
  closed: { Icon: GitPullRequestClosedIcon, tone: 'failed', name: 'pullRequestClosed' },
} as const;

function PullRequestIcon({ pull }: { pull: PullRequestReference }) {
  const { t } = useLocalization();
  const { Icon, tone, name } = pullRequestStates[pull.state];
  return <span className={`forge-icon forge-${tone}`} role="img" aria-label={t(name)}><Icon size={14} /></span>;
}
