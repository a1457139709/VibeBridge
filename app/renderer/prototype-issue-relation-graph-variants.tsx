// PROTOTYPE: three ways to show what the workbench concludes about an issue, above the Forge body.
// A = spec #341 as written; B = verdict line + chip rows; C = verdict line + the parent's sub-issue plan.
import { useRef, useState, type ReactNode } from 'react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { BlockedMark, IssueIcon, Post, Progress, PullRequestIcon, RelativeTime } from './forge/ForgeDisplay';
import type { IssueReference } from '../shared/forge/forge';
import type { DispatchRecordView } from '../shared/dispatch';
import { DispatchSkill, SessionId, type DispatchRecordsHost } from './dispatch/DispatchRecords';
import { useLocalization } from './common/Localization';
import { agentIcons } from './common/agent-icons';
import { agentNames } from '../shared/model';
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

function DispatchFooter({ records, act, label = true }: { records: DispatchRecordView[]; act: Act; label?: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = records.at(-1);
  if (!latest) return null;
  return (
    <div className="proto-dispatch-summary">
      <div className="proto-dispatch-summary-line">
        {label && <span className="proto-label">派发 {records.length} 次</span>}
        <DispatchLine record={latest} act={act} />
        {records.length > 1 && (
          <button className="proto-link" onClick={() => setOpen(!open)}>
            {open ? '收起' : label ? '全部' : `全部 ${records.length} 次`}
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

function SubIssueRow({ sub, act }: { sub: SubIssue; act: Act }) {
  const blockers = openBlockers(sub);
  const by = blockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }));
  return (
    <button
      className={`forge-ref sb-row ${sub.state === 'closed' ? 'closed' : ''} ${blockers.length ? 'blocked end' : ''}`}
      data-hint={sub.title}
      onClick={() => act.openIssue(sub)}
    >
      <IssueIcon issue={sub} />
      <span className="sb-text">
        <span className="sb-title-line">
          <span className="forge-row-number">#{sub.number}</span>
          <span className="forge-ellipsis">{sub.title}</span>
        </span>
      </span>
      {!!blockers.length && <BlockedMark by={by} />}
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
}: {
  issue: FocusIssue;
  act: Act;
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
        <SubIssueRow key={sub.number} sub={sub} act={act} />
      ))}
    </section>
  );
}

function ForgeBody({
  issue,
  act,
  anchor,
  actions,
}: {
  issue: FocusIssue;
  act: Act;
  anchor?: React.Ref<HTMLElement>;
  actions?: VariantProps['actions'];
}) {
  return (
    <>
      <div className="ga-rule">
        <MarkGithubIcon size={12} /> GitHub 原文
      </div>
      <div className="forge-doc-main">
        <Post author={issue.author} createdAt={issue.createdAt} html={issue.body} />
        {!!issue.subIssues.length && <SubIssueBox issue={issue} act={act} anchor={anchor} />}
        {issue.comments.map((comment, index) => (
          <Post key={index} {...comment} />
        ))}
        <Actions issue={issue} actions={actions} />
      </div>
    </>
  );
}

// ───────────────────────── A: spec #341 as written ─────────────────────────

export function SpecVariant({ issue, records, width, act, dispatchButton, actions }: VariantProps) {
  const list = useRef<HTMLElement>(null);
  const hasSubs = !!issue.subIssues.length;
  const openSubs = issue.subIssues.filter(sub => sub.state === 'open');
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
  const hasGraph = hasSubs || !!issue.blockedBy.length || !!issue.blocking.length;
  const counts = `${issue.subIssueProgress.closed}/${issue.subIssueProgress.total}`;
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} dispatchButton={dispatchButton} />
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
      <ForgeBody issue={issue} act={act} anchor={list} actions={actions} />
    </div>
  );
}

// ───────────────────────── shared by B and C: the verdict ─────────────────────────

type Tone = 'done' | 'blocked' | 'working' | 'ready' | 'waiting';
export interface Verdict {
  tone: Tone;
  head: string;
  facts: string[];
}

const isActive = (pull: TimedPull) => pull.state === 'open' || pull.state === 'draft';
const readySubs = (issue: FocusIssue) =>
  issue.subIssues.filter(sub => sub.state === 'open' && !openBlockers(sub).length);

export function verdictOf(issue: FocusIssue): Verdict {
  const facts: string[] = [];
  const active = issue.closingPullRequests.filter(isActive);
  const merged = issue.closingPullRequests.filter(pull => pull.state === 'merged');
  const waitingOn = issue.blockedBy.filter(blocker => blocker.state === 'open');
  const openSubs = issue.subIssues.filter(sub => sub.state === 'open');
  if (issue.state === 'closed') {
    if (merged.length) facts.push(`由 #${merged[0].number} 合入`);
    return { tone: 'done', head: '已完成', facts };
  }
  for (const pull of active) facts.push(`#${pull.number} ${pullStateText[pull.state]} · ${checkWord[pull.checks]}`);
  if (waitingOn.length)
    return { tone: 'blocked', head: `等 ${waitingOn.map(blocker => `#${blocker.number}`).join('、')} 完成`, facts };
  if (openSubs.length) {
    const ready = readySubs(issue);
    return {
      tone: 'waiting',
      head: `还剩 ${openSubs.length} 个子 issue`,
      facts: [
        ready.length ? `${ready.map(sub => `#${sub.number}`).join('、')} 可以开始` : '都在等别的 issue',
        ...facts,
      ],
    };
  }
  if (active.length)
    return { tone: active.some(pull => pull.checks === 'failed') ? 'blocked' : 'working', head: '有 PR 在做', facts };
  return {
    tone: 'ready',
    head: '可以开始',
    facts: [
      issue.blocking.length
        ? `做完能解开 ${issue.blocking.filter(item => item.state === 'open').length} 个 issue`
        : '没有阻塞项',
    ],
  };
}

function VerdictLine({ issue, records, act }: { issue: FocusIssue; records: DispatchRecordView[]; act: Act }) {
  const verdict = verdictOf(issue);
  const latest = records.at(-1);
  return (
    <div className={`vb-verdict ${verdict.tone}`} role="status">
      <div className="vb-verdict-head">
        <span className="vb-dot" aria-hidden />
        <b>{verdict.head}</b>
        {verdict.facts.map(fact => (
          <span key={fact} className="vb-fact">
            {fact}
          </span>
        ))}
      </div>
      {latest ? (
        <div className="vb-verdict-dispatch">
          <span className="proto-muted">上次派发</span>
          <FakeTag />
          <DispatchFooter records={records} act={act} label={false} />
        </div>
      ) : (
        issue.state === 'open' && <div className="vb-verdict-dispatch proto-muted">还没派发过</div>
      )}
    </div>
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

function IssueChip({ issue, act, mark }: { issue: IssueReference; act: Act; mark?: ReactNode }) {
  const outside = !issue.url.includes('/example/workbench/');
  return (
    <button
      className={`vb-chip ${issue.state} ${outside ? 'outside' : ''}`}
      data-hint={`#${issue.number} ${issue.title}${outside ? '\n（其他仓库，在浏览器打开）' : ''}`}
      onClick={() => act.openIssue(issue)}
    >
      <IssueIcon issue={issue} size={11} decorative />
      {outside ? 'terminal-core' : ''}#{issue.number}
      {mark}
    </button>
  );
}

function RelationRows({ issue, act, showSubs }: { issue: FocusIssue; act: Act; showSubs: boolean }) {
  const waiting = openCount(issue.blockedBy);
  const unblocks = issue.blocking;
  const pulls = issue.closingPullRequests;
  return (
    <div className="vb-rows">
      {issue.parent && (
        <ChipRow label="属于">
          <button className="vb-parent" onClick={() => act.openIssue(issue.parent!)} data-hint={issue.parent.title}>
            <IssueIcon issue={issue.parent} size={11} decorative />#{issue.parent.number}
            <span className="forge-ellipsis">{issue.parent.title}</span>
            <Progress {...issue.parent.progress} />
          </button>
        </ChipRow>
      )}
      {!!issue.blockedBy.length && (
        <ChipRow label="等待" note={waiting ? `${waiting} 未解决` : '已全部解决'}>
          {issue.blockedBy.map(item => (
            <IssueChip key={item.url} issue={item} act={act} />
          ))}
        </ChipRow>
      )}
      {!!unblocks.length && (
        <ChipRow label="解锁">
          {unblocks.map(item => (
            <IssueChip key={item.url} issue={item} act={act} />
          ))}
        </ChipRow>
      )}
      {showSubs && !!issue.subIssues.length && (
        <ChipRow label="子 issue" note={`${issue.subIssueProgress.closed}/${issue.subIssueProgress.total}`}>
          {issue.subIssues.map(sub => {
            const blockers = openBlockers(sub);
            return (
              <IssueChip
                key={sub.url}
                issue={sub}
                act={act}
                mark={
                  blockers.length ? (
                    <BlockedMark
                      by={blockers.map(blocker => ({ reference: `#${blocker.number}`, title: blocker.title }))}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </ChipRow>
      )}
      <ChipRow label="PR">
        {pulls.length ? (
          pulls.map(pull => <PullChip key={pull.number} pull={pull} act={act} />)
        ) : (
          <span className="proto-muted">还没有 pull request</span>
        )}
      </ChipRow>
    </div>
  );
}

// ───────────────────────── B: verdict + chip rows ─────────────────────────

export function VerdictVariant({ issue, records, act, dispatchButton, actions }: VariantProps) {
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} dispatchButton={dispatchButton} />
      <section className={`vb-card ${issue.state}`} aria-label="工作台的结论">
        <VerdictLine issue={issue} records={records} act={act} />
        <RelationRows issue={issue} act={act} showSubs />
      </section>
      <ForgeBody issue={issue} act={act} actions={actions} />
    </div>
  );
}

// ───────────────────────── C: verdict + the sub-issue plan ─────────────────────────

type Step = 'done' | 'ready' | 'blocked';
const stepOf = (sub: SubIssue): Step =>
  sub.state === 'closed' ? 'done' : openBlockers(sub).length ? 'blocked' : 'ready';
const stepWord = { done: '完成', ready: '可以开始', blocked: '等待中' } as const;

function layersOf(subs: SubIssue[]) {
  const inside = new Map(subs.map(sub => [sub.number, sub]));
  const depth = new Map<number, number>();
  const visit = (sub: SubIssue, seen: Set<number>): number => {
    const known = depth.get(sub.number);
    if (known !== undefined) return known;
    if (seen.has(sub.number)) return 0;
    seen.add(sub.number);
    const parents = sub.blockedBy.flatMap(blocker => {
      const sibling = inside.get(blocker.number);
      return sibling ? [visit(sibling, seen) + 1] : [];
    });
    const value = Math.max(0, ...parents);
    depth.set(sub.number, value);
    return value;
  };
  for (const sub of subs) visit(sub, new Set());
  const layers: SubIssue[][] = [];
  for (const sub of subs) (layers[depth.get(sub.number) ?? 0] ??= []).push(sub);
  return layers;
}

function Plan({
  owner,
  subs,
  focus,
  width,
  act,
}: {
  owner: FocusIssue['parent'] | FocusIssue;
  subs: SubIssue[];
  focus: number | null;
  width: number;
  act: Act;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const inside = new Set(subs.map(sub => sub.number));
  const layers = layersOf(subs);
  const edges: Edge[] = subs.flatMap(sub =>
    sub.blockedBy
      .filter(blocker => inside.has(blocker.number))
      .map(blocker => ({
        from: `p${blocker.number}`,
        to: `p${sub.number}`,
        kind: 'blocks' as const,
        done: blocker.state === 'closed',
      })),
  );
  const lit = hover ?? focus;
  const near = new Set(
    lit === null
      ? []
      : [
          lit,
          ...edges.filter(edge => edge.to === `p${lit}`).map(edge => Number(edge.from.slice(1))),
          ...edges.filter(edge => edge.from === `p${lit}`).map(edge => Number(edge.to.slice(1))),
        ],
  );
  const shown = edges.map(edge => ({
    ...edge,
    kind: lit !== null && (edge.from === `p${lit}` || edge.to === `p${lit}`) ? ('blocking' as const) : edge.kind,
  }));
  const ready = subs.filter(sub => stepOf(sub) === 'ready');
  if (!owner) return null;
  return (
    <div className="pc-plan" onMouseLeave={() => setHover(null)}>
      <div className="pc-plan-head">
        {focus !== null ? (
          <button className="vb-parent" onClick={() => act.openIssue(owner)} data-hint={owner.title}>
            <span aria-hidden>↑</span>
            <IssueIcon issue={owner} size={11} decorative />#{owner.number}
            <span className="forge-ellipsis">{owner.title}</span>
          </button>
        ) : (
          <span className="proto-label">执行顺序</span>
        )}
        <span className="forge-spacer" />
        <span className="proto-muted">
          {subs.filter(sub => sub.state === 'closed').length}/{subs.length} 完成 · {ready.length} 个可以开始
        </span>
      </div>
      <div className="pc-plot">
        <Edges edges={shown} version={`${focus} ${width} ${lit}`} />
        {layers.map((layer, index) => (
          <div key={index} className="pc-layer">
            <span className="pc-step">{index + 1}</span>
            <div className="pc-layer-nodes">
              {layer.map(sub => {
                const step = stepOf(sub);
                const outside = sub.blockedBy.filter(
                  blocker => !inside.has(blocker.number) && blocker.state === 'open',
                );
                return (
                  <button
                    key={sub.number}
                    data-node={`p${sub.number}`}
                    className={`pc-node ${step} ${sub.number === focus ? 'self' : ''} ${lit !== null && !near.has(sub.number) ? 'dim' : ''}`}
                    data-hint={`#${sub.number} ${sub.title}\n${stepWord[step]}${outside.length ? `\n还在等其他仓库的 ${outside.map(item => `#${item.number}`).join('、')}` : ''}`}
                    onMouseEnter={() => setHover(sub.number)}
                    onClick={() => sub.number !== focus && act.openIssue(sub)}
                  >
                    <IssueIcon issue={sub} size={11} decorative />
                    <span className="proto-num">#{sub.number}</span>
                    <span className="forge-ellipsis">{sub.title}</span>
                    {!!outside.length && (
                      <span className="pc-outside" aria-label="还在等其他仓库">
                        ⛓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlanVariant({ issue, records, width, act, siblings, dispatchButton, actions }: VariantProps) {
  const ownPlan = issue.subIssues.length > 0;
  const parentPlan = !ownPlan && issue.parent && siblings?.length;
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} dispatchButton={dispatchButton} />
      <section className={`vb-card pc ${issue.state}`} aria-label="工作台的结论">
        <VerdictLine issue={issue} records={records} act={act} />
        {ownPlan && <Plan owner={issue} subs={issue.subIssues} focus={null} width={width} act={act} />}
        {parentPlan && <Plan owner={issue.parent} subs={siblings} focus={issue.number} width={width} act={act} />}
        <RelationRows
          issue={
            parentPlan
              ? {
                  ...issue,
                  parent: null,
                  blockedBy: issue.blockedBy.filter(item => !siblings.some(sub => sub.number === item.number)),
                  blocking: issue.blocking.filter(item => !siblings.some(sub => sub.number === item.number)),
                }
              : issue
          }
          act={act}
          showSubs={false}
        />
      </section>
      <ForgeBody issue={issue} act={act} actions={actions} />
    </div>
  );
}

// ───────────────────────── D: C, reworked ─────────────────────────
// No hints or step labels. Sub-issues are grouped by dependency depth, separated only by space.
// Hover uses the live relation graph's colours: red = blocks it, green = the issue itself, yellow = it unblocks.
// Dispatch records: folded shows the latest one; unfolded shows all of them, latest included.

function LatestFirstDispatchRecords({
  records,
  startFolded,
  host,
}: {
  records: DispatchRecordView[];
  startFolded: boolean;
  host: DispatchRecordsHost;
}) {
  const { t } = useLocalization();
  const [open, setOpen] = useState(!startFolded);
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

function Groups({
  owner,
  subs,
  focus,
  act,
  layout = 'chips',
}: {
  owner: NonNullable<FocusIssue['parent']> | FocusIssue;
  subs: SubIssue[];
  focus: number | null;
  act: Act;
  layout?: GroupLayout;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const lit = hover ?? focus;
  const inside = new Set(subs.map(sub => sub.number));
  const litSub = subs.find(sub => sub.number === lit);
  const before = new Set(litSub?.blockedBy.filter(item => inside.has(item.number)).map(item => item.number) ?? []);
  const after = new Set(
    lit === null ? [] : subs.filter(sub => sub.blockedBy.some(item => item.number === lit)).map(sub => sub.number),
  );
  const relation = (n: number) =>
    n === lit ? 'self' : before.has(n) ? 'blockedBy' : after.has(n) ? 'blocking' : lit !== null ? 'dim' : undefined;
  return (
    <div className={`dg dg-${layout}`} onMouseLeave={() => setHover(null)}>
      {focus !== null && (
        <button className="vb-parent dg-owner" onClick={() => act.openIssue(owner)} data-hint={owner.title}>
          <span aria-hidden>↑</span>
          <IssueIcon issue={owner} size={11} decorative />#{owner.number}
          <span className="forge-ellipsis">{owner.title}</span>
          <Progress {...('progress' in owner ? owner.progress : owner.subIssueProgress)} />
        </button>
      )}
      <div className="dg-groups">
        {layersOf(subs).map((layer, index) => (
          <div key={index} className="dg-group">
            {layer.map(sub => {
              const blockers = openBlockers(sub);
              return (
                <button
                  key={sub.number}
                  className={`dg-node ${sub.state} ${sub.number === focus ? 'focus' : ''}`}
                  data-relation={relation(sub.number)}
                  data-hint={`#${sub.number} ${sub.title}`}
                  onMouseEnter={() => setHover(sub.number)}
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
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

type GroupLayout = 'chips' | 'bands' | 'columns' | 'cards';

export function StepsVariant(props: VariantProps) {
  return <GroupedVariant {...props} layout="chips" />;
}
// E: full-width rows; each group is a band, bands alternate shade and are split by a rule.
export function BandsVariant(props: VariantProps) {
  return <GroupedVariant {...props} layout="bands" />;
}
// F: groups are columns left → right split by vertical rules; narrow panes stack them.
export function ColumnsVariant(props: VariantProps) {
  return <GroupedVariant {...props} layout="columns" />;
}
// G: each group is a bordered card, cards chained with a chevron; narrow panes stack them.
export function CardsVariant(props: VariantProps) {
  return <GroupedVariant {...props} layout="cards" />;
}

function GroupedVariant({
  issue,
  records,
  act,
  siblings,
  dispatchButton,
  actions,
  dispatchHost,
  layout,
}: VariantProps & { layout: GroupLayout }) {
  const ownPlan = issue.subIssues.length > 0;
  const parentPlan = !ownPlan && issue.parent && siblings?.length;
  const others = parentPlan
    ? {
        ...issue,
        parent: null,
        blockedBy: issue.blockedBy.filter(item => !siblings.some(sub => sub.number === item.number)),
        blocking: issue.blocking.filter(item => !siblings.some(sub => sub.number === item.number)),
      }
    : issue;
  return (
    <div className="forge-doc">
      <TitleBlock issue={issue} dispatchButton={dispatchButton} />
      {!!records.length && dispatchHost && (
        <LatestFirstDispatchRecords
          key={`${issue.number} ${issue.state}`}
          records={records}
          startFolded
          host={dispatchHost}
        />
      )}
      <section className={`vb-card ds ${issue.state}`} aria-label="关系">
        {ownPlan && <Groups owner={issue} subs={issue.subIssues} focus={null} act={act} layout={layout} />}
        {parentPlan && <Groups owner={issue.parent!} subs={siblings} focus={issue.number} act={act} layout={layout} />}
        <RelationRows issue={others} act={act} showSubs={false} />
      </section>
      <ForgeBody issue={issue} act={act} actions={actions} />
    </div>
  );
}
