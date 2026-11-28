import { useState, type MouseEvent, type ReactNode } from 'react';
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
import { IssueComments } from './IssueComments';
import './relation-graph.css';
import {
  BlockedMark,
  IssueIcon,
  issueDisplayState,
  issueStates,
  ItemReference,
  Label,
  linkedItem,
  MoreOnForge,
  OpenPullRequestChecks,
  Post,
  Progress,
  PullRequestIcon,
  RelativeTime,
} from './ForgeDisplay';
import type { DetailItem } from '../../shared/forge/sidebar-data';
import { useResizeObserver } from '../common/resize-observer';

interface DocumentProps {
  project: ProjectView & { repository: RepositoryReference };
  issue: IssueDetail;
  open(item: DetailItem): void;
  followLink(event: MouseEvent): void;
  actions: Actions;
  dispatch: IssueDispatch;
}

export interface IssueDispatch {
  button: ReactNode;
  records: DispatchRecordView[];
  host: DispatchRecordsHost;
}

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
              {t('subIssues')} <Progress {...issue.subIssueProgress} />
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
            {issue.subIssueProgress.total > subIssues.length && (
              <MoreOnForge
                message="moreSubIssues"
                count={issue.subIssueProgress.total - subIssues.length}
                forge={project.forge.name}
                url={issue.url}
              />
            )}
          </section>
        )}
        <IssueComments key={issue.number} issue={issue} forge={project.forge.name} />
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

type BlockingRelation = 'blockedBy' | 'blocking';
const blockingRelations: readonly BlockingRelation[] = ['blockedBy', 'blocking'];
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
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useResizeObserver(host, entry => setWidth(entry.contentRect.width));
  const columns: { name: Relation; head: string; nodes: IssueReference[] }[] = [
    { name: 'blockedBy', head: t('blockedByColumn'), nodes: left },
    { name: 'self', head: t('thisIssue'), nodes: [issue] },
    { name: 'blocking', head: t('blockingColumn'), nodes: right },
  ];
  const columnWidth = (width - padding * 2 - gap * 2) / 3;
  const rows = Math.max(left.length, right.length, 1);
  const at = (column: number, row: number) => ({
    x: padding + column * (columnWidth + gap),
    y: headHeight + (row + (rows - columns[column].nodes.length) / 2) * rowHeight,
  });
  const height = headHeight + rows * rowHeight + 4;
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
    <div className="forge-graph" role="group" aria-label={t('relations')} ref={setHost} style={{ height }}>
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
