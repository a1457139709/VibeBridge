import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useLocalization } from '../common/Localization';
import type {
  IssueDetail,
  IssueReference,
  ForgeLinks,
  PullRequestReference,
  RepositoryReference,
} from '../../shared/forge/forge';
import type { ProjectView } from '../../shared/model';
import type { DispatchRecordView } from '../../shared/dispatch';
import { IssueActions, type Actions } from './DirectActions';
import { DispatchRecords, type DispatchRecordsHost } from '../dispatch/DispatchRecords';
import './relation-graph.css';
import {
  BlockedMark,
  IssueIcon,
  issueDisplayState,
  issueStates,
  ItemReference,
  Label,
  linkedItem,
  OpenPullRequestChecks,
  Post,
  Progress,
  PullRequestIcon,
  RelativeTime,
} from './ForgeDisplay';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { requireValue } from '../common/required';

interface DocumentProps {
  project: ProjectView & { repository: RepositoryReference };
  issue: IssueDetail;
  /** Opens an issue or pull request of the bound repository in the detail. */
  open(item: DetailItem): void;
  /** Opens a clicked link of the bound repository in the detail. */
  followLink(event: MouseEvent): void;
  actions: Actions;
  dispatch: IssueDispatch;
}

/** What the detail shows of dispatching an issue: its Dispatch, and its Dispatch Records, oldest first. */
export interface IssueDispatch {
  button: ReactNode;
  records: DispatchRecordView[];
  host: DispatchRecordsHost;
}

/** One issue as its detail shows it: the parent, title, state, labels and Dispatch, its Dispatch Records, the relation graph, the pull requests
 * that close it, then the body, sub-issues and comments in the forge's own rendering, filtered, and its direct actions last. */
export function IssueDocument({ project, issue, open, followLink, actions, dispatch }: DocumentProps) {
  const { t } = useLocalization();
  const { capabilities } = project;
  const openReference = (reference: IssueReference) => {
    const item = linkedItem(reference.url, issue.links);
    if (item) open(item);
    else window.open(reference.url, '_blank');
  };
  const openBlockers = issue.blockedBy.filter(blocker => blocker.state === 'open');
  const subIssues = capabilities.subIssues ? issue.subIssues : [];
  const parent = capabilities.subIssues ? issue.parent : null;
  return (
    <div className="forge-doc" onClick={followLink}>
      {parent && (
        <button className="forge-parent" onClick={() => openReference(parent)}>
          <IssueIcon issue={parent} size={12} />
          <span className="forge-ellipsis">{parent.title}</span>
          <span className="forge-row-number">#{parent.number}</span>
          {!!parent.progress.total && <Progress {...parent.progress} />}
        </button>
      )}
      <h2>
        {issue.title} <span className="forge-row-number">#{issue.number}</span>
      </h2>
      <div className="forge-doc-head">
        <StatePill issue={issue} />
        {issue.labels.map(label => (
          <Label key={label.name} label={label} />
        ))}
        <span className="forge-spacer" />
        {capabilities.blocking && issue.state === 'open' && !!openBlockers.length && (
          <BlockedMark by={openBlockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }))} />
        )}
        {issue.state === 'open' && dispatch.button}
      </div>
      <div className="forge-doc-meta">
        <b>{issue.author ?? t('deletedAccount')}</b> {t('issueOpened')} <RelativeTime iso={issue.createdAt} />
        {' · '}
        {issue.commentCount === 1 ? t('oneComment') : t('commentCount', { count: issue.commentCount })}
        {!!issue.assignees.length && (
          <>
            {' · '}
            {t('assigneeList', { names: issue.assignees.join(', ') })}
          </>
        )}
      </div>
      {!!dispatch.records.length && (
        <DispatchRecords
          key={`${issue.number} ${issue.state}`}
          records={dispatch.records}
          startFolded={issue.state === 'closed'}
          host={dispatch.host}
        />
      )}
      {capabilities.blocking && <RelationGraph issue={issue} blockers={openBlockers} follow={openReference} />}
      {!!issue.closingPullRequests.length && (
        <ClosingPullRequests pullRequests={issue.closingPullRequests} links={issue.links} open={open} />
      )}
      <div className="forge-doc-main">
        <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
        {!!subIssues.length && (
          <section className="forge-box" aria-label={t('subIssues')}>
            <header>
              {t('subIssues')}{' '}
              <Progress closed={subIssues.filter(sub => sub.state === 'closed').length} total={subIssues.length} />
            </header>
            {subIssues.map(sub => (
              <button
                key={sub.number}
                className={`forge-ref ${sub.state === 'closed' ? 'closed' : ''}`}
                data-hint={sub.title}
                onClick={() => openReference(sub)}
              >
                <IssueIcon issue={sub} />
                <span className="forge-ellipsis">{sub.title}</span>
                <span className="forge-row-number">#{sub.number}</span>
              </button>
            ))}
          </section>
        )}
        {issue.comments.map((comment, index) => (
          <Post key={index} {...comment} />
        ))}
        {issue.commentCount > issue.comments.length && (
          <a className="forge-more-comments" href={issue.url} target="_blank" rel="noreferrer">
            {t('moreComments', { count: issue.commentCount, forge: project.forge.name })}
          </a>
        )}
        <IssueActions issue={issue} actions={actions} />
      </div>
    </div>
  );
}

function StatePill({ issue }: { issue: IssueDetail }) {
  const { t } = useLocalization();
  const { tone, short } = issueStates[issueDisplayState(issue)];
  return (
    <span className={`forge-pill forge-bg-${tone}`}>
      <IssueIcon issue={issue} decorative />
      {t(short)}
    </span>
  );
}

/** The small graph at the top of the detail, only of issues and only of live blocking: the open blockers on the left, the issue
 * in the middle, and on the right the open issues it still blocks while it is open. It sits on its own plate, each column
 * coloured by its relation. Nothing to draw, no graph. */
function RelationGraph({
  issue,
  blockers: left,
  follow,
}: {
  issue: IssueDetail;
  blockers: IssueReference[];
  follow(reference: IssueReference): void;
}) {
  const right = issue.state === 'open' ? issue.blocking.filter(blocked => blocked.state === 'open') : [];
  if (!left.length && !right.length) return null;
  return <Graph issue={issue} left={left} right={right} follow={follow} />;
}

/** A blocking relation the graph draws as an edge: an open blocker of the issue, or an open issue it blocks. */
type BlockingRelation = 'blockedBy' | 'blocking';
const blockingRelations: readonly BlockingRelation[] = ['blockedBy', 'blocking'];
/** A graph column, named by its nodes' relation to the issue; the issue itself is `self`. */
type Relation = BlockingRelation | 'self';

const rowHeight = 28,
  headHeight = 20,
  padding = 8,
  gap = 28;
function Graph({
  issue,
  left,
  right,
  follow,
}: {
  issue: IssueDetail;
  left: IssueReference[];
  right: IssueReference[];
  follow(reference: IssueReference): void;
}) {
  const { t } = useLocalization();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(requireValue(host.current, 'the relations graph'));
    return () => observer.disconnect();
  }, []);
  const columns: { name: Relation; head: string; nodes: IssueReference[] }[] = [
    { name: 'blockedBy', head: t('blockedByColumn'), nodes: left },
    { name: 'self', head: t('thisIssue'), nodes: [issue] },
    { name: 'blocking', head: t('blockingColumn'), nodes: right },
  ];
  const columnWidth = (width - padding * 2 - gap * 2) / 3;
  const rows = Math.max(left.length, right.length, 1);
  // Shorter columns are centred against the tallest.
  const at = (column: number, row: number) => ({
    x: padding + column * (columnWidth + gap),
    y: headHeight + (row + (rows - columns[column].nodes.length) / 2) * rowHeight,
  });
  const height = headHeight + rows * rowHeight + 4;
  // An edge, its arrow and its column head take the colour of the relation's column.
  const edge = (
    from: { x: number; y: number },
    to: { x: number; y: number },
    column: BlockingRelation,
    key: string,
  ) => {
    const x1 = from.x + columnWidth,
      y1 = from.y + rowHeight / 2 - 2,
      x2 = to.x,
      y2 = to.y + rowHeight / 2 - 2,
      middle = (x1 + x2) / 2;
    return (
      <path
        key={key}
        className="forge-edge"
        data-relation={column}
        d={`M${x1} ${y1} C${middle} ${y1} ${middle} ${y2} ${x2 - 1} ${y2}`}
        markerEnd={`url(#forge-arrow-${column})`}
      />
    );
  };
  const self = at(1, 0);
  return (
    <div className="forge-graph" role="group" aria-label={t('relations')} ref={host} style={{ height }}>
      {columns.map((column, index) => (
        <span
          key={column.name}
          className="forge-graph-head"
          data-relation={column.name}
          style={{ left: padding + index * (columnWidth + gap), width: columnWidth }}
        >
          {column.head}
        </span>
      ))}
      <svg width={width} height={height} aria-hidden>
        <defs>
          {blockingRelations.map(column => (
            <marker
              key={column}
              id={`forge-arrow-${column}`}
              data-relation={column}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0 0L8 4L0 8z" />
            </marker>
          ))}
        </defs>
        {left.map((blocker, row) => edge(at(0, row), self, 'blockedBy', `left-${blocker.number}`))}
        {right.map((blocked, row) => edge(self, at(2, row), 'blocking', `right-${blocked.number}`))}
      </svg>
      {columns.map((column, index) =>
        column.nodes.map((node, row) => {
          const { x, y } = at(index, row);
          const content = (
            <>
              <IssueIcon issue={node} size={12} decorative />
              <span className="forge-row-number">#{node.number}</span>
              <span className="forge-ellipsis">{node.title}</span>
            </>
          );
          const style = { left: x, top: y, width: columnWidth };
          return column.name === 'self' ? (
            <div key={node.number} className="forge-node self" data-relation={column.name} style={style}>
              {content}
            </div>
          ) : (
            <button
              key={node.number}
              className="forge-node"
              data-relation={column.name}
              style={style}
              data-hint={`#${node.number} ${node.title}`}
              onClick={() => follow(node)}
            >
              {content}
            </button>
          );
        }),
      )}
    </div>
  );
}

/** The pull requests that close the issue on merge, closed ones included, apart from the issue graph and drawn as pull
 * requests. An open or draft one shows its checks conclusion. One of the bound repository opens in the detail; another
 * repository's opens in the browser. */
function ClosingPullRequests({
  pullRequests,
  links,
  open,
}: {
  pullRequests: PullRequestReference[];
  links: ForgeLinks;
  open(item: DetailItem): void;
}) {
  const { t } = useLocalization();
  return (
    <section className="forge-closing-pulls" aria-label={t('closingPullRequests')}>
      <header>{t('closingPullRequests')}</header>
      <ul>
        {pullRequests.map(pullRequest => (
          <li key={pullRequest.url}>
            <ItemReference
              kind="pullRequest"
              url={pullRequest.url}
              links={links}
              open={open}
              className="forge-closing-pull"
              hint={pullRequest.title}
            >
              <PullRequestIcon state={pullRequest.state} size={14} hint={false} />
              <span className="forge-row-number">#{pullRequest.number}</span>
              <span className="forge-ellipsis">{pullRequest.title}</span>
              <OpenPullRequestChecks state={pullRequest.state} checks={pullRequest.checks} />
            </ItemReference>
          </li>
        ))}
      </ul>
    </section>
  );
}
