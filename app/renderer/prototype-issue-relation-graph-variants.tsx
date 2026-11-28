// PROTOTYPE: the issue document settled in rounds A–H (see branch history), now comparing comment layouts.
// Settled: dispatch records on their own row (latest shown when folded); the sub-issue list is the relation
// view (hover: green = this, red = blocks it, yellow = it unblocks); no "GitHub 原文" divider.
// Comments: a timeline under the body; only the latest two show until the older ones are expanded.
// Each open row of the relation list can be dispatched: a button on hover, or right-click.
import { useState, type ReactNode } from 'react';
import { BlockedMark, IssueIcon, Post, Progress, PullRequestIcon, RelativeTime } from './forge/ForgeDisplay';
import type { IssueReference } from '../shared/forge/forge';
import { filterForgeHtml } from '../shared/forge/forge-html';
import type { DispatchRecordView } from '../shared/dispatch';
import { DispatchSkill, SessionId, type DispatchRecordsHost } from './dispatch/DispatchRecords';
import { useLocalization } from './common/Localization';
import { agentIcons } from './common/agent-icons';
import { agentNames } from '../shared/model';
import type { FocusIssue, SubIssue, TimedPull } from './prototype-issue-relation-graph-data';
import {
  Actions,
  pullStateText,
  TitleBlock,
  openCount,
  type Act,
  type VariantProps,
} from './prototype-issue-relation-graph-parts';

const checkMark = { passed: '✓', failed: '✗', pending: '●', none: '' } as const;
const checkTone = { passed: 'forge-open', failed: 'forge-failed', pending: 'forge-pending', none: '' } as const;
const checkWord = { passed: '检查通过', failed: '检查失败', pending: '检查中', none: '无检查' } as const;

const openBlockers = (sub: SubIssue) =>
  sub.state === 'open' ? sub.blockedBy.filter(blocker => blocker.state === 'open') : [];

// ───────────── dispatch records: folded shows the latest; unfolded shows all, latest included ─────────────

function LatestFirstDispatchRecords({ records, host }: { records: DispatchRecordView[]; host: DispatchRecordsHost }) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(false);
  const heading = t('dispatchRecords', { count: records.length });
  const shown = open ? records.toReversed() : records.slice(-1);
  return (
    <section className="forge-box dispatch-records" aria-label={heading}>
      <header>
        <button className="dispatch-records-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden>{open ? '▾' : '▸'}</span> {heading}
        </button>
      </header>
      <ul>
        {shown.map(record => (
          <li key={`${record.dispatchedAt} ${record.sessionId}`} className="dispatch-record">
            <span className="dispatch-record-when">
              <RelativeTime iso={record.dispatchedAt} />
            </span>
            <span className={`agent-mark ${record.agent}`} role="img" aria-label={agentNames[record.agent]}>
              {agentIcons[record.agent]}
            </span>
            <DispatchSkill record={record} host={host} />
            {record.sessionId && <SessionId id={record.sessionId} report={host.report} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ───────────── the sub-issue list is the relation view ─────────────

type Owner = NonNullable<FocusIssue['parent']> | FocusIssue;

type DispatchFor = VariantProps['dispatchFor'];

function SubIssueList({
  subs,
  focus,
  act,
  dispatchFor,
}: {
  subs: SubIssue[];
  focus: number | null;
  act: Act;
  dispatchFor: DispatchFor;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const lit = hover ?? focus;
  const litSub = subs.find(sub => sub.number === lit);
  const before = new Set(litSub?.blockedBy.map(item => item.number) ?? []);
  const after = new Set(subs.filter(sub => sub.blockedBy.some(item => item.number === lit)).map(sub => sub.number));
  const relation = (n: number) =>
    n === lit ? 'self' : before.has(n) ? 'blockedBy' : after.has(n) ? 'blocking' : lit !== null ? 'dim' : undefined;
  return (
    <div className="dg dg-list" onMouseLeave={() => setHover(null)}>
      {subs.map(sub => {
        const blockers = openBlockers(sub);
        const canDispatch = !!dispatchFor && sub.state === 'open' && sub.number !== focus;
        return (
          <div
            key={sub.number}
            className={`dg-node dg-row ${sub.state}`}
            data-relation={relation(sub.number)}
            onMouseEnter={() => setHover(sub.number)}
            onContextMenu={event => {
              if (!canDispatch) return;
              event.preventDefault();
              dispatchFor.open(sub.number);
            }}
          >
            <button
              className="dg-open"
              data-hint={`#${sub.number} ${sub.title}${canDispatch ? '\n右键派发' : ''}`}
              onFocus={() => setHover(sub.number)}
              onClick={() => sub.number !== focus && act.openIssue(sub)}
            >
              <IssueIcon issue={sub} size={12} decorative />
              <span className="forge-row-number">#{sub.number}</span>
              <span className="forge-ellipsis">{sub.title}</span>
              {!!blockers.length && (
                <BlockedMark
                  by={blockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }))}
                />
              )}
            </button>
            {canDispatch && <span className="dg-dispatch">{dispatchFor.button(sub)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function SubIssueBox({
  owner,
  subs,
  focus,
  act,
  startFolded,
  dispatchFor,
}: {
  owner: Owner;
  subs: SubIssue[];
  focus: number | null;
  act: Act;
  startFolded: boolean;
  dispatchFor: DispatchFor;
}) {
  const [open, setOpen] = useState(!startFolded);
  const progress = 'progress' in owner ? owner.progress : owner.subIssueProgress;
  return (
    <section className="forge-box dl-box" aria-label="子 issue">
      <header>
        <button className="dispatch-records-toggle dl-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span aria-hidden>{open ? '▾' : '▸'}</span> {focus === null ? '子 issue' : '同级 issue'}
        </button>
        {focus !== null && (
          <button className="dl-owner" onClick={() => act.openIssue(owner)} data-hint={owner.title}>
            <IssueIcon issue={owner} size={11} decorative />#{owner.number}
            <span className="forge-ellipsis">{owner.title}</span>
          </button>
        )}
        <span className="forge-spacer" />
        <Progress {...progress} />
      </header>
      {open && <SubIssueList subs={subs} focus={focus} act={act} dispatchFor={dispatchFor} />}
    </section>
  );
}

// ───────────── other relations: waits / unblocks / PR ─────────────

function PullChip({ pull, act }: { pull: TimedPull; act: Act }) {
  return (
    <button
      className={`lg-pchip ${pull.state}`}
      data-hint={`#${pull.number} ${pull.title}\n${pullStateText[pull.state]} · ${checkWord[pull.checks]}`}
      onClick={() => act.openPull(pull)}
    >
      <PullRequestIcon state={pull.state} size={11} hint={false} />#{pull.number}
      {pull.checks !== 'none' && <span className={checkTone[pull.checks]}>{checkMark[pull.checks]}</span>}
    </button>
  );
}

function ChipRow({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return (
    <div className="vb-row">
      <span className="vb-key">{label}</span>
      <span className="vb-chips">
        {children}
        {note && <span className="vb-note">{note}</span>}
      </span>
    </div>
  );
}

function IssueChip({ issue, act }: { issue: IssueReference; act: Act }) {
  const outside = !issue.url.includes('/example/workbench/');
  return (
    <button
      className={`vb-chip ${issue.state} ${outside ? 'outside' : ''}`}
      data-hint={`#${issue.number} ${issue.title}${outside ? '\n（其他仓库，在浏览器打开）' : ''}`}
      onClick={() => act.openIssue(issue)}
    >
      <IssueIcon issue={issue} size={11} decorative />
      {outside ? 'terminal-core' : ''}#{issue.number}
    </button>
  );
}

function OtherRelations({ issue, act }: { issue: FocusIssue; act: Act }) {
  const waiting = openCount(issue.blockedBy);
  return (
    <section className="forge-box dl-rows" aria-label="其他关系">
      <div className="vb-rows">
        {!!issue.blockedBy.length && (
          <ChipRow label="其他阻塞" note={waiting ? `${waiting} 未解决` : '已全部解决'}>
            {issue.blockedBy.map(item => (
              <IssueChip key={item.url} issue={item} act={act} />
            ))}
          </ChipRow>
        )}
        {!!issue.blocking.length && (
          <ChipRow label="解锁">
            {issue.blocking.map(item => (
              <IssueChip key={item.url} issue={item} act={act} />
            ))}
          </ChipRow>
        )}
        <ChipRow label="PR">
          {issue.closingPullRequests.length ? (
            issue.closingPullRequests.map(pull => <PullChip key={pull.number} pull={pull} act={act} />)
          ) : (
            <span className="proto-muted">还没有 pull request</span>
          )}
        </ChipRow>
      </div>
    </section>
  );
}

// ───────────── comment layouts ─────────────

type Comment = FocusIssue['comments'][number];
const shownComments = 2;

function useOlderFold(comments: Comment[]) {
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, comments.length - shownComments);
  return { shown: comments.slice(hidden), hidden, expand: () => setAll(true) };
}

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <article className="cm-item">
      <div className="cm-head">
        <b>{comment.author}</b> <RelativeTime iso={comment.createdAt} />
      </div>
      <div className="forge-markdown" dangerouslySetInnerHTML={{ __html: filterForgeHtml(comment.html) }} />
    </article>
  );
}

function CommentRun({ comments }: { comments: Comment[] }) {
  const { shown, hidden, expand } = useOlderFold(comments);
  return (
    <>
      {!!hidden && (
        <button className="cm-older" onClick={expand}>
          展开前面 {hidden} 条评论
        </button>
      )}
      {shown.map(comment => (
        <CommentItem key={comment.createdAt} comment={comment} />
      ))}
    </>
  );
}

// Comments hang off a thin vertical line under the body card, with no card chrome.
function TimelineComments({ comments }: { comments: Comment[] }) {
  return (
    <div className="cm-timeline">
      <CommentRun comments={comments} />
    </div>
  );
}

// ───────────── the document ─────────────

function IssueDocument({
  issue,
  records,
  act,
  siblings,
  dispatchButton,
  actions,
  dispatchHost,
  dispatchFor,
}: VariantProps) {
  const ownList = issue.subIssues.length > 0;
  const parentList = !ownList && issue.parent && siblings?.length ? siblings : null;
  const others = parentList
    ? {
        ...issue,
        blockedBy: issue.blockedBy.filter(item => !parentList.some(sub => sub.number === item.number)),
        blocking: issue.blocking.filter(item => !parentList.some(sub => sub.number === item.number)),
      }
    : issue;
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} dispatchButton={dispatchButton} />
      {!!records.length && dispatchHost && (
        <LatestFirstDispatchRecords key={`${issue.number} ${issue.state}`} records={records} host={dispatchHost} />
      )}
      {ownList && (
        <SubIssueBox
          owner={issue}
          subs={issue.subIssues}
          focus={null}
          act={act}
          startFolded={issue.state === 'closed'}
          dispatchFor={dispatchFor}
        />
      )}
      {parentList && (
        <SubIssueBox
          owner={issue.parent!}
          subs={parentList}
          focus={issue.number}
          act={act}
          startFolded={false}
          dispatchFor={dispatchFor}
        />
      )}
      <OtherRelations issue={others} act={act} />
      <div className="forge-doc-main">
        <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
        {!!issue.comments.length && <TimelineComments comments={issue.comments} />}
        <Actions issue={issue} actions={actions} />
      </div>
    </div>
  );
}

export const TimelineVariant = IssueDocument;
