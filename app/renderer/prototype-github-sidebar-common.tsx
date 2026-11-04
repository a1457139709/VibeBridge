// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Small shared pieces for v2: state colour, labels, progress, checks text, the split dispatch button and the dispatch status.
import React, { useEffect, useRef, useState } from 'react';
import { BlockedIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestDraftIcon, GitPullRequestIcon, IssueClosedIcon, IssueOpenedIcon, SkipIcon } from '@primer/octicons-react';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { statusName } from './prototype-ephemeral-panels-data';
import { defaultStep, steps, type DispatchRecord, type Filter, type Issue, type Pane, type Pull, type Repo, type StateFilter } from './prototype-github-sidebar-model';

export const issueTone = (i: Issue) => i.state === 'open' ? 'open' : i.reason === 'not_planned' ? 'skipped' : 'done';
export const pullTone = (p: Pull) => ({ open: 'open', draft: 'skipped', merged: 'done', closed: 'failed' } as const)[p.state];
const issueStateName = (i: Issue) => i.state === 'open' ? '开放' : i.reason === 'not_planned' ? '不做' : '已完成';
const pullStateName = { open: '开放', draft: '草稿', merged: '已合并', closed: '已关闭' };

/** GitHub's own state octicons, coloured like GitHub. */
export function IssueIcon({ issue, size = 16 }: { issue: Issue; size?: number }) {
  const Icon = issue.state === 'open' ? IssueOpenedIcon : issue.reason === 'not_planned' ? SkipIcon : IssueClosedIcon;
  return <span className={`gh-icon gh-${issueTone(issue)}`}><Icon size={size} /></span>;
}
export function PullIcon({ pull, size = 16 }: { pull: Pull; size?: number }) {
  const Icon = { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon }[pull.state];
  return <span className={`gh-icon gh-${pullTone(pull)}`}><Icon size={size} /></span>;
}
export const IssuePill = ({ issue }: { issue: Issue }) => <span className={`gh-pill gh-bg-${issueTone(issue)}`}><IssueIcon issue={issue} />{issueStateName(issue)}</span>;
export const PullPill = ({ pull }: { pull: Pull }) => <span className={`gh-pill gh-bg-${pullTone(pull)}`}><PullIcon pull={pull} />{pullStateName[pull.state]}</span>;
/** The one blocking mark used everywhere: 「被 #N、#M 阻塞」, hover shows the blockers' titles. */
export const Blocked = ({ repo, by }: { repo: Repo; by: number[] }) => <span className="gh-blocked" title={by.map(b => `#${b} ${repo.issues.get(b)?.title ?? '不在快照里'}`).join('\n')}>
  <BlockedIcon size={12} />被 {by.map(b => `#${b}`).join('、')} 阻塞</span>;

export function Label({ repo, name, onClick }: { repo: Repo; name: string; onClick?(): void }) {
  return <span className={`gh-label ${onClick ? 'clickable' : ''}`} style={{ '--label': repo.labelColor.get(name) ?? '#888' } as React.CSSProperties}
    onClick={onClick && (e => { e.stopPropagation(); onClick(); })}>{name}</span>;
}

export function Progress({ closed, total }: { closed: number; total: number }) {
  if (!total) return null;
  return <span className="gh-progress" title={`子 issue：${closed} / ${total} 已关闭`}><span className="gh-progress-bar"><span style={{ width: `${closed / total * 100}%` }} /></span>{closed}/{total}</span>;
}

export function checksText(state: string) {
  if (state === 'success') return { tone: 'open', text: '检查通过' };
  if (state === 'failure' || state === 'error' || state === 'timed_out' || state === 'cancelled' || state === 'action_required') return { tone: 'failed', text: '检查失败' };
  if (state === 'none') return { tone: 'skipped', text: '没有检查' };
  if (state === 'skipped' || state === 'neutral') return { tone: 'skipped', text: '已跳过' };
  return { tone: 'pending', text: '检查中' };
}
export const reviewText = (review: string) => ({ approved: { tone: 'open', text: '已批准' }, changes_requested: { tone: 'failed', text: '需要修改' }, review_required: { tone: 'pending', text: '等待评审' } } as Record<string, { tone: string; text: string }>)[review];

export function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return { open, setOpen, root };
}

/** Main half sends with the defaults (new ephemeral panel + default step); the caret picks a step and a target. */
export function DispatchSplit({ issue, panes, onDispatch, weak = false, size = 'row' }: {
  issue: Issue; panes: Pane[]; onDispatch(step: string, pane: string | 'new'): void; weak?: boolean; size?: 'row' | 'detail';
}) {
  const pop = usePopover();
  const [step, setStep] = useState(defaultStep);
  const send = (pane: string | 'new') => { onDispatch(step, pane); pop.setOpen(false); };
  return <div className={`gh-split ${weak ? 'weak' : ''} ${size}`} ref={pop.root} onClick={e => e.stopPropagation()}>
    <button className="gh-split-main" title={`用默认指令 ${defaultStep} #${issue.number} 派发到新临时面板`} onClick={() => onDispatch(defaultStep, 'new')}>派发</button>
    <button className="gh-split-more" title="选择指令和面板" aria-expanded={pop.open} onClick={() => pop.setOpen(o => !o)}>▾</button>
    {pop.open && <div className="gh-pop gh-dispatch-pop">
      <div className="gh-pop-title">指令</div>
      {steps.map(s => <button key={s} className={step === s ? 'on' : ''} onClick={() => setStep(s)}><code>{s} #{issue.number}</code>{s === defaultStep && <small>默认</small>}</button>)}
      <div className="gh-pop-title">交给</div>
      <button onClick={() => send('new')}><span>新临时面板</span><small>默认</small></button>
      {panes.map(p => <button key={p.id} className={p.agent} onClick={() => send(p.id)}><span className="gh-agent-dot" /><span className="gh-ellipsis">{p.title}</span><small>{p.ephemeral ? '临时' : '常驻'}</small></button>)}
    </div>}
  </div>;
}

/** Where the issue's latest dispatch is now: the pane's processing state, clickable to locate the pane. */
export function DispatchStatus({ records, panes, onLocate }: { records: DispatchRecord[]; panes: Pane[]; onLocate(pane: string): void }) {
  const last = records[records.length - 1];
  const pane = panes.find(p => p.id === last.pane);
  if (!pane) return <span className="gh-dstatus gone" title="派发去的会话已不在任何打开的面板上">已派发{records.length > 1 ? ` ×${records.length}` : ''}</span>;
  return <button className={`gh-dstatus status-${pane.status}`} title={`${last.step} → ${pane.title}（点击定位面板）`} onClick={e => { e.stopPropagation(); onLocate(pane.id); }}>
    <span className="gh-dstatus-state"><ProcessingStatusIcon state={pane.status} />{statusName[pane.status]}{records.length > 1 ? ` ×${records.length}` : ''}</span>
    <span className="gh-dstatus-pane">{pane.title}</span>
  </button>;
}

export function FilterBar({ repo, filter, setFilter, counts, labels = true }: { repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; counts: Record<StateFilter, number>; labels?: boolean }) {
  const pop = usePopover();
  const used = repo.snapshot.labels.map(l => ({ ...l, count: repo.snapshot.issues.filter(i => i.labels.includes(l.name)).length })).filter(l => l.count);
  const toggle = (name: string) => setFilter(f => ({ ...f, labels: f.labels.includes(name) ? f.labels.filter(l => l !== name) : [...f.labels, name] }));
  return <div className="gh-filters">
    <input className="gh-search" value={filter.q} placeholder="搜索标题，或输入 #编号" onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />
    <div className="gh-filter-row">
      {(['open', 'closed'] as StateFilter[]).map(s => <button key={s} className={`gh-state-tab ${filter.state === s ? 'on' : ''}`} onClick={() => setFilter(f => ({ ...f, state: s }))}>
        {s === 'open' ? '开放' : '已关闭'} <span>{counts[s]}</span></button>)}
      <span className="gh-spacer" />
      {labels && <div className="gh-pop-root" ref={pop.root}>
        <button className={`gh-text-button ${filter.labels.length ? 'on' : ''}`} onClick={() => pop.setOpen(o => !o)}>标签{filter.labels.length ? ` ${filter.labels.length}` : ''} ▾</button>
        {pop.open && <div className="gh-pop gh-label-pop">{used.map(l => <button key={l.name} className={filter.labels.includes(l.name) ? 'on' : ''} onClick={() => toggle(l.name)}>
          <span className="gh-swatch" style={{ background: `#${l.color}` }} /><span className="gh-ellipsis">{l.name}</span><small>{l.count}</small><b>{filter.labels.includes(l.name) ? '✓' : ''}</b></button>)}
          {!!filter.labels.length && <button className="gh-pop-clear" onClick={() => setFilter(f => ({ ...f, labels: [] }))}>清除</button>}</div>}
      </div>}
    </div>
    {!!filter.labels.length && <div className="gh-active-labels">{filter.labels.map(l => <Label key={l} repo={repo} name={l} onClick={() => toggle(l)} />)}<span>点标签移除</span></div>}
  </div>;
}
