import { useRef, useState, type ReactNode } from 'react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { BlockedMark, IssueIcon, Post, Progress, PullRequestIcon } from './forge/ForgeDisplay';
import type { DispatchRecordView } from '../shared/dispatch';
import type { FocusIssue, SubIssue, TimedPull } from './prototype-issue-relation-graph-data';
import {
  Actions,
  DispatchLine,
  Edges,
  FakeTag,
  IssueRef,
  openCount,
  pullStateText,
  TitleBlock,
  type Act,
  type Edge,
  type VariantProps,
} from './prototype-issue-relation-graph-parts';

const checkMark = { passed: '✓', failed: '✗', pending: '●', none: '' } as const;
const checkTone = { passed: 'forge-open', failed: 'forge-failed', pending: 'forge-pending', none: '' } as const;
const checkWord = { passed: '检查通过', failed: '检查失败', pending: '检查中', none: '无检查' } as const;

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

function DispatchFooter({ records, act }: { records: DispatchRecordView[]; act: Act }) {
  const [open, setOpen] = useState(false);
  const latest = records.at(-1);
  if (!latest) return null;
  return (
    <div className="proto-dispatch-summary">
      <div className="proto-dispatch-summary-line">
        <span className="proto-label">派发 {records.length} 次</span>
        <FakeTag />
        <DispatchLine record={latest} act={act} />
        {records.length > 1 && (
          <button className="proto-link" onClick={() => setOpen(!open)}>
            {open ? '收起' : '全部'}
          </button>
        )}
      </div>
      {open && (
        <ul className="proto-dispatch-list">
          {records
            .toReversed()
            .slice(1)
            .map(record => (
              <li key={record.dispatchedAt}>
                <DispatchLine record={record} act={act} />
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

const openBlockers = (sub: SubIssue) =>
  sub.state === 'open' ? sub.blockedBy.filter(blocker => blocker.state === 'open') : [];

type BlockedPlacement = 'end' | 'lead' | 'line';

function SubIssueRow({ sub, act, blocked }: { sub: SubIssue; act: Act; blocked: BlockedPlacement }) {
  const blockers = openBlockers(sub);
  const by = blockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }));
  const hint = [sub.title, ...blockers.map(blocker => `被 #${blocker.number} ${blocker.title} 阻塞`)].join('\n');
  const isBlocked = !!blockers.length;
  return (
    <button
      className={`forge-ref sb-row ${sub.state === 'closed' ? 'closed' : ''} ${isBlocked ? `blocked ${blocked}` : ''}`}
      data-hint={hint}
      onClick={() => act.openIssue(sub)}
    >
      {isBlocked && blocked === 'lead' ? (
        <span className="sb-lead-blocked" aria-label="被阻塞">
          <BlockedMark by={[]} />
        </span>
      ) : (
        <IssueIcon issue={sub} />
      )}
      <span className="sb-text">
        <span className="sb-title-line">
          <span className="forge-row-number">#{sub.number}</span>
          <span className="forge-ellipsis">{sub.title}</span>
        </span>
        {isBlocked && blocked === 'line' && (
          <span className="sb-blocked-line">
            <BlockedMark by={by} /> <span className="proto-muted">完成后才能开始</span>
          </span>
        )}
      </span>
      {isBlocked && blocked === 'end' && <BlockedMark by={by} />}
      {isBlocked && blocked === 'lead' && (
        <span className="sb-lead-by">{by.map(item => item.reference).join(' ')}</span>
      )}
    </button>
  );
}

function SubIssueBox({
  issue,
  act,
  only,
  heading = '子 issue',
  tail,
  node,
  anchor,
  blocked,
}: {
  issue: FocusIssue;
  act: Act;
  blocked: BlockedPlacement;
  only?: SubIssue[];
  heading?: string;
  tail?: ReactNode;
  node?: string;
  anchor?: React.Ref<HTMLElement>;
}) {
  const rows = only ?? issue.subIssues;
  return (
    <section className="forge-box sb-box" aria-label={heading} data-node={node} ref={anchor}>
      <header>
        {heading} <Progress {...issue.subIssueProgress} />
        <span className="forge-spacer" />
        {tail}
      </header>
      {rows.map(sub => (
        <SubIssueRow key={sub.number} sub={sub} act={act} blocked={blocked} />
      ))}
    </section>
  );
}

function Unit({ issue, records, width, act, blocked }: VariantProps & { blocked: BlockedPlacement }) {
  const list = useRef<HTMLElement>(null);
  const hasSubs = !!issue.subIssues.length;
  const openSubs = issue.subIssues.filter(sub => sub.state === 'open');
  const blockedSubs = openSubs.filter(sub => openBlockers(sub).length);
  const jump = () => list.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const edges: Edge[] = [
    ...issue.blockedBy.map(item => ({
      from: `b${item.number}`,
      to: 'self',
      kind: 'blocks' as const,
      done: item.state === 'closed',
    })),
    ...issue.blocking.map(item => ({
      from: 'self',
      to: `k${item.number}`,
      kind: 'blocking' as const,
      done: issue.state === 'closed',
    })),
  ];
  const parent = issue.parent;
  const pulls = issue.closingPullRequests;
  const fullListBelow = hasSubs;
  const hasGraph = hasSubs || !!issue.blockedBy.length || !!issue.blocking.length;
  const counts = `${issue.subIssueProgress.closed}/${issue.subIssueProgress.total}`;
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} />
      <section className={`ga lg ${issue.state}`} aria-label="关系">
        {parent && (
          <button
            className="lg-crumb"
            data-hint={`父 issue：#${parent.number} ${parent.title}`}
            onClick={() => act.openIssue(parent)}
          >
            <span aria-hidden>↑</span>
            <IssueIcon issue={parent} size={11} decorative />
            <span className="proto-num">#{parent.number}</span>
            <span className="forge-ellipsis">{parent.title}</span>
            <span className="lg-crumb-progress">
              · {parent.progress.closed}/{parent.progress.total}
            </span>
          </button>
        )}
        {hasGraph && (
          <div className="ga-plot">
            <Edges edges={edges} version={`${issue.number} ${issue.state} ${width}`} />
            <div className="ga-mid">
              {!!issue.blockedBy.length && (
                <div className="ga-col">
                  <span className="ga-caption blocks">
                    被阻塞于 {openCount(issue.blockedBy) ? `· ${openCount(issue.blockedBy)} 未解决` : '· 已全部解决'}
                  </span>
                  {issue.blockedBy.map(item => (
                    <div key={item.number} data-node={`b${item.number}`} className="ga-node">
                      <IssueRef issue={item} act={act} />
                    </div>
                  ))}
                </div>
              )}
              <div className={`ga-self lg-self ${issue.state}`} data-node="self">
                <div className="ga-self-head">
                  <IssueIcon issue={issue} size={14} decorative />
                  <b>#{issue.number}</b>
                  <span className="proto-muted">本 issue</span>
                </div>
              </div>
              {!!issue.blocking.length && (
                <div className="ga-col">
                  <span className="ga-caption blocking">阻塞</span>
                  {issue.blocking.map(item => (
                    <div key={item.number} data-node={`k${item.number}`} className="ga-node">
                      <IssueRef issue={item} act={act} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            {hasSubs &&
              (openSubs.length ? (
                <SubIssueBox
                  issue={issue}
                  act={act}
                  node="children"
                  only={openSubs}
                  blocked={blocked}
                  heading={`未完成的子 issue · ${openSubs.length}`}
                  tail={
                    <button className="proto-link" onClick={jump}>
                      全部 {issue.subIssues.length} 个 ↓
                    </button>
                  }
                />
              ) : (
                <button className="sb-pointer" data-node="children" onClick={jump}>
                  <span className="proto-label">子 issue 全部完成</span>
                  <Progress {...issue.subIssueProgress} />
                  <span className="forge-spacer" />
                  <span className="proto-link">查看 {counts} ↓</span>
                </button>
              ))}
          </div>
        )}
        <div className="lg-strip">
          <span className="lg-strip-key">
            <PullRequestIcon state="open" size={11} hint={false} /> 关闭本 issue
          </span>
          {pulls.length ? (
            pulls.map(pull => <PullChip key={pull.number} pull={pull} act={act} />)
          ) : (
            <span className="proto-muted">还没有 pull request</span>
          )}
        </div>
        <DispatchFooter records={records} act={act} />
      </section>
      <div className="ga-rule">
        <MarkGithubIcon size={12} /> GitHub 原文
      </div>
      <div className="forge-doc-main">
        <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
        {fullListBelow && <SubIssueBox issue={issue} act={act} anchor={list} blocked={blocked} />}
        {issue.comments.map((comment, index) => (
          <Post key={index} {...comment} />
        ))}
        <Actions issue={issue} />
      </div>
    </div>
  );
}

export const BlockedAtEndVariant = (props: VariantProps) => <Unit {...props} blocked="end" />;
export const BlockedLeadVariant = (props: VariantProps) => <Unit {...props} blocked="lead" />;
export const BlockedLineVariant = (props: VariantProps) => <Unit {...props} blocked="line" />;
