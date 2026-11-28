import type { DispatchRecordsHost } from './dispatch/DispatchRecords';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useLocalization } from './common/Localization';
import {
  IssueIcon,
  issueDisplayState,
  issueStates,
  Label,
  Post,
  PullRequestIcon,
  RelativeTime,
} from './forge/ForgeDisplay';
import { IssueActions, idleActions, type Actions as DirectActions } from './forge/DirectActions';
import { agentIcons } from './common/agent-icons';
import { agentNames, type AgentType } from '../shared/model';
import type { IssueReference } from '../shared/forge/forge';
import type { DispatchRecordView } from '../shared/dispatch';
import type { FocusIssue, SubIssue, TimedPull } from './prototype-issue-relation-graph-data';

export interface Act {
  openIssue(issue: IssueReference): void;
  openPull(pull: TimedPull): void;
  locate(record: DispatchRecordView): void;
}
export interface VariantProps {
  issue: FocusIssue;
  records: DispatchRecordView[];
  width: number;
  act: Act;
  siblings?: SubIssue[];
  dispatchButton?: ReactNode;
  actions?: DirectActions;
  dispatchHost?: DispatchRecordsHost;
}

export function AgentMark({ agent, size = 13 }: { agent: AgentType; size?: number }) {
  return (
    <span
      className={`agent-mark proto-agent ${agent}`}
      style={{ fontSize: size, width: size + 3 }}
      role="img"
      aria-label={agentNames[agent]}
      data-hint={agentNames[agent]}
    >
      {agentIcons[agent]}
    </span>
  );
}

export function IssueRef({
  issue,
  act,
  title = true,
  className = '',
}: {
  issue: IssueReference;
  act: Act;
  title?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`proto-ref ${issue.state} ${className}`}
      data-hint={`#${issue.number} ${issue.title}`}
      onClick={() => act.openIssue(issue)}
    >
      <IssueIcon issue={issue} size={12} decorative />
      <span className="proto-num">#{issue.number}</span>
      {title && <span className="forge-ellipsis">{issue.title}</span>}
    </button>
  );
}

export const pullStateText = { open: '打开', draft: '草稿', merged: '已合并', closed: '已关闭' } as const;
const checkText = { passed: '检查通过', failed: '检查失败', pending: '检查中' } as const;
const checkTone = { passed: 'forge-open', failed: 'forge-failed', pending: 'forge-pending' } as const;
const checkMark = { passed: '✓', failed: '✗', pending: '●' } as const;

export function Checks({ pull, words = true }: { pull: TimedPull; words?: boolean }) {
  if (pull.checks === 'none') return null;
  return (
    <span className={`proto-checks ${checkTone[pull.checks]}`} data-hint={checkText[pull.checks]}>
      {checkMark[pull.checks]}
      {words && ` ${checkText[pull.checks]}`}
    </span>
  );
}

export function PullLine({ pull, act, compact = false }: { pull: TimedPull; act: Act; compact?: boolean }) {
  return (
    <button
      className={`proto-pull ${pull.state}`}
      data-hint={`#${pull.number} ${pull.title}`}
      onClick={() => act.openPull(pull)}
    >
      <PullRequestIcon state={pull.state} size={12} hint={false} />
      <span className="proto-num">#{pull.number}</span>
      {!compact && <span className="forge-ellipsis">{pull.title}</span>}
      <span className={`proto-pull-state ${pull.state}`}>{pullStateText[pull.state]}</span>
      <Checks pull={pull} words={!compact} />
    </button>
  );
}

export function FakeTag() {
  return (
    <span className="proto-fake" data-hint="原型：所有数据都是编造的">
      示例
    </span>
  );
}

export function SkillButton({ record, act }: { record: DispatchRecordView; act: Act }) {
  return (
    <button
      className={`proto-skill ${record.location ? '' : 'gone'}`}
      data-hint={record.location ? '点击定位到它所在的面板' : '会话已不在打开的面板里'}
      onClick={() => act.locate(record)}
    >
      {record.skill}
    </button>
  );
}

export function DispatchLine({ record, act }: { record: DispatchRecordView; act: Act }) {
  return (
    <span className="proto-dispatch-line">
      <span className="proto-muted">
        <RelativeTime iso={record.dispatchedAt} />
      </span>
      <span className="proto-sep">·</span>
      <AgentMark agent={record.agent} />
      <SkillButton record={record} act={act} />
      <span className="proto-sep">·</span>
      <code className="proto-session" data-hint={record.sessionId}>
        {record.sessionId?.slice(0, 8)}
      </code>
    </span>
  );
}

export function StatePill({ issue }: { issue: FocusIssue }) {
  const { t } = useLocalization();
  const { tone, short } = issueStates[issueDisplayState(issue)];
  return (
    <span className={`forge-pill forge-bg-${tone}`}>
      <IssueIcon issue={issue} decorative />
      {t(short)}
    </span>
  );
}

export function TitleBlock({
  issue,
  meta = true,
  dispatchButton,
}: {
  issue: FocusIssue;
  meta?: boolean;
  dispatchButton?: ReactNode;
}) {
  const { t } = useLocalization();
  return (
    <>
      <h2>
        {issue.title} <span className="forge-row-number">#{issue.number}</span>
      </h2>
      <div className="forge-doc-head">
        <StatePill issue={issue} />
        {issue.labels.map(label => (
          <Label key={label.name} label={label} />
        ))}
        <span className="forge-spacer" />
        {issue.state === 'open' &&
          (dispatchButton ?? (
            <div className="dispatch">
              <button className="dispatch-button">
                {t('dispatch')}
                <span aria-hidden="true"> ▾</span>
              </button>
            </div>
          ))}
      </div>
      {meta && (
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
      )}
    </>
  );
}

export function Posts({ issue }: { issue: FocusIssue }) {
  return (
    <>
      <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
      {issue.comments.map((comment, index) => (
        <Post key={index} {...comment} />
      ))}
    </>
  );
}

export function Actions({ issue, actions }: { issue: FocusIssue; actions?: DirectActions }) {
  return (
    <IssueActions
      issue={{ ...issue, closingPullRequests: issue.closingPullRequests }}
      actions={actions ?? { ...idleActions, perform: () => {}, dismiss: () => {} }}
    />
  );
}

const avatarColors = ['#0969da', '#8250df', '#bf3989', '#1a7f37', '#9a6700', '#cf222e'];
export function Avatar({ login, size = 28 }: { login: string | null; size?: number }) {
  const name = login ?? '?';
  const color = avatarColors[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % avatarColors.length];
  return (
    <span
      className="proto-avatar"
      style={{ width: size, height: size, background: color, fontSize: size * 0.45 }}
      aria-hidden
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const openCount = (list: IssueReference[]) => list.filter(item => item.state === 'open').length;

export interface Edge {
  from: string;
  to: string;
  kind: 'blocks' | 'blocking' | 'child' | 'parent' | 'pull';
  done: boolean;
}

export function Edges({ edges, version }: { edges: Edge[]; version: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState<(Edge & { d: string })[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const key = edges.map(edge => `${edge.from}>${edge.to}`).join(' ');
  useLayoutEffect(() => {
    const host = svg.current?.parentElement;
    if (!host) return;
    const measure = () => {
      const box = host.getBoundingClientRect();
      const rect = (name: string) => {
        const found = host.querySelector(`[data-node="${name}"]`)?.getBoundingClientRect();
        return (
          found && {
            left: found.left - box.left,
            right: found.right - box.left,
            top: found.top - box.top,
            bottom: found.bottom - box.top,
          }
        );
      };
      setSize({ width: box.width, height: box.height });
      setDrawn(
        edges.flatMap(edge => {
          const a = rect(edge.from),
            b = rect(edge.to);
          if (!a || !b) return [];
          const acx = (a.left + a.right) / 2,
            bcx = (b.left + b.right) / 2,
            acy = (a.top + a.bottom) / 2,
            bcy = (b.top + b.bottom) / 2;
          let d: string;
          if (b.left >= a.right - 1) {
            const m = (a.right + b.left) / 2;
            d = `M${a.right} ${acy} C${m} ${acy} ${m} ${bcy} ${b.left - 1} ${bcy}`;
          } else if (b.top >= a.bottom - 1) {
            const m = (a.bottom + b.top) / 2;
            d = `M${acx} ${a.bottom} C${acx} ${m} ${bcx} ${m} ${bcx} ${b.top - 1}`;
          } else {
            const m = (a.top + b.bottom) / 2;
            d = `M${acx} ${a.top} C${acx} ${m} ${bcx} ${m} ${bcx} ${b.bottom + 1}`;
          }
          return [{ ...edge, d }];
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [key, version]);
  return (
    <svg ref={svg} className="proto-edges" width={size.width} height={size.height} aria-hidden>
      <defs>
        {(['blocks', 'blocking'] as const).map(kind => (
          <marker
            key={kind}
            id={`proto-arrow-${kind}`}
            className={`proto-marker ${kind}`}
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
      {drawn.map(edge => (
        <path
          key={`${edge.from}>${edge.to}`}
          className={`proto-edge ${edge.kind} ${edge.done ? 'done' : ''}`}
          d={edge.d}
          markerEnd={edge.kind === 'blocks' || edge.kind === 'blocking' ? `url(#proto-arrow-${edge.kind})` : undefined}
        />
      ))}
    </svg>
  );
}
