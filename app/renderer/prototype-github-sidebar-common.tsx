// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Pieces every sidebar variant shows: filter bar, state glyphs, issue / PR detail and the stub dispatch menu.
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { ago, childProgress, githubUrl, openBlockers, steps, type DispatchRecord, type Filter, type Issue, type Pull, type Repo, type Selected, type Sort, type StateFilter } from './prototype-github-sidebar-model';

export function IssueGlyph({ issue }: { issue: Issue }) {
  const tone = issue.state === 'open' ? 'open' : issue.reason === 'not_planned' ? 'skipped' : 'done';
  return <span className={`gh-glyph gh-${tone}`} title={issue.state === 'open' ? '开放' : issue.reason === 'not_planned' ? '已关闭（不做）' : '已完成'}>{issue.state === 'open' ? '◉' : issue.reason === 'not_planned' ? '⊘' : '✓'}</span>;
}
export function PullGlyph({ pull }: { pull: Pull }) {
  const tone = { open: 'open', draft: 'skipped', merged: 'done', closed: 'failed' }[pull.state];
  return <span className={`gh-glyph gh-pr gh-${tone}`} title={{ open: '开放', draft: '草稿', merged: '已合并', closed: '已关闭' }[pull.state]}>⇄</span>;
}
export function Checks({ pull }: { pull: Pull }) {
  if (pull.checks === 'none') return null;
  const ok = pull.checks === 'success';
  const bad = pull.checks === 'failure' || pull.checks === 'error';
  return <span className={`gh-checks ${ok ? 'gh-open' : bad ? 'gh-failed' : 'gh-pending'}`} title={`检查：${pull.checks}`}>{ok ? '✓' : bad ? '✗' : '●'}</span>;
}
export function LabelChip({ repo, name, onClick, active }: { repo: Repo; name: string; onClick?(): void; active?: boolean }) {
  const color = repo.labelColor.get(name) ?? '#888';
  return <span className={`gh-label ${active ? 'active' : ''}`} style={{ '--label': color } as React.CSSProperties} onClick={onClick && (e => { e.stopPropagation(); onClick(); })}>{name}</span>;
}

function usePopover() {
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

export function Filters({ repo, filter, setFilter, counts, showState = true, showSort = true, extra }: {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; counts?: { open: number; closed: number }; showState?: boolean; showSort?: boolean; extra?: ReactNode;
}) {
  const labels = usePopover();
  const used = repo.snapshot.labels.map(l => ({ ...l, count: repo.snapshot.issues.filter(i => i.labels.includes(l.name)).length })).filter(l => l.count);
  const toggle = (name: string) => setFilter(f => ({ ...f, labels: f.labels.includes(name) ? f.labels.filter(l => l !== name) : [...f.labels, name] }));
  return <div className="gh-filters">
    <div className="gh-search"><span>⌕</span><input value={filter.q} placeholder="搜索标题，或输入 #编号" onChange={e => setFilter(f => ({ ...f, q: e.target.value }))} />{filter.q && <button onClick={() => setFilter(f => ({ ...f, q: '' }))}>×</button>}</div>
    <div className="gh-filter-row">
      {showState && <span className="gh-seg">{(['open', 'closed', 'all'] as StateFilter[]).map(s => <button key={s} className={filter.state === s ? 'on' : ''} onClick={() => setFilter(f => ({ ...f, state: s }))}>
        {{ open: '开放', closed: '已关闭', all: '全部' }[s]}{counts && s !== 'all' ? <small> {counts[s]}</small> : null}</button>)}</span>}
      <div className="gh-pop-root" ref={labels.root}>
        <button className={`gh-dropdown ${filter.labels.length ? 'on' : ''}`} onClick={() => labels.setOpen(o => !o)}>标签{filter.labels.length ? ` · ${filter.labels.length}` : ''} ▾</button>
        {labels.open && <div className="gh-pop gh-label-pop">{used.map(l => <button key={l.name} className={filter.labels.includes(l.name) ? 'on' : ''} onClick={() => toggle(l.name)}>
          <span className="gh-dot" style={{ background: `#${l.color}` }} /><span>{l.name}</span><small>{l.count}</small>{filter.labels.includes(l.name) && <b>✓</b>}</button>)}
          {!!filter.labels.length && <button className="gh-pop-clear" onClick={() => setFilter(f => ({ ...f, labels: [] }))}>清除标签筛选</button>}</div>}
      </div>
      {showSort && <select value={filter.sort} onChange={e => setFilter(f => ({ ...f, sort: e.target.value as Sort }))} title="排序">
        <option value="updated">最近更新</option><option value="created">最新创建</option><option value="created-asc">最早创建</option></select>}
      {extra}
    </div>
    {!!filter.labels.length && <div className="gh-active-labels">{filter.labels.map(l => <LabelChip key={l} repo={repo} name={l} active onClick={() => toggle(l)} />)}<span className="muted">（同时满足）</span></div>}
  </div>;
}

export interface Pane { id: string; title: string; agent: string; ephemeral: boolean }

function DispatchButton({ issue, panes, onDispatch }: { issue: Issue; panes: Pane[]; onDispatch(r: DispatchRecord): void }) {
  const pop = usePopover();
  const [step, setStep] = useState(steps[0]);
  const send = (session: string, located: boolean) => { onDispatch({ issue: issue.number, session, step, at: new Date().toISOString(), located }); pop.setOpen(false); };
  return <div className="gh-pop-root" ref={pop.root}>
    <button className="gh-primary" onClick={() => pop.setOpen(o => !o)}>派发 ▾</button>
    {pop.open && <div className="gh-pop gh-dispatch-pop">
      <label>指令<select value={step} onChange={e => setStep(e.target.value)}>{steps.map(s => <option key={s}>{s}</option>)}</select></label>
      <code>{step === '自由指令' ? `处理 #${issue.number}：…` : `${step} #${issue.number}`}</code>
      <div className="gh-pop-title">交给</div>
      <button className="on" onClick={() => send(`新会话 · #${issue.number}`, true)}>＋ 新临时面板 <small>默认</small></button>
      {panes.map(p => <button key={p.id} className={p.agent} onClick={() => send(p.title, true)}><span className="gh-agent-dot" />{p.title}<small>{p.ephemeral ? '临时' : '常驻'}</small></button>)}
      <p className="muted">原型：只追加一条派发记录，不会真的发送。</p>
    </div>}
  </div>;
}

export function PullRow({ repo, pull, onOpen }: { repo: Repo; pull: Pull; onOpen?(s: Selected): void }) {
  return <button className="gh-rel-row" onClick={() => onOpen?.({ kind: 'pull', number: pull.number })}>
    <PullGlyph pull={pull} /><span className="gh-num">#{pull.number}</span><span className="gh-ellipsis">{pull.title}</span><Checks pull={pull} />
    {pull.review === 'approved' && <small className="gh-open">已批准</small>}{pull.review === 'changes_requested' && <small className="gh-failed">要求修改</small>}
    <small className="muted">{repo.snapshot.repo ? `+${pull.additions} −${pull.deletions}` : ''}</small>
  </button>;
}

function IssueRef({ repo, n, onOpen, note }: { repo: Repo; n: number; onOpen?(s: Selected): void; note?: string }) {
  const i = repo.issues.get(n);
  if (!i) return <div className="gh-rel-row muted">#{n}（不在快照里）</div>;
  return <button className="gh-rel-row" onClick={() => onOpen?.({ kind: 'issue', number: n })}><IssueGlyph issue={i} /><span className="gh-num">#{n}</span><span className="gh-ellipsis">{i.title}</span>{note && <small className="muted">{note}</small>}</button>;
}

export function IssueDetail({ repo, issue, onOpen, panes, dispatches, onDispatch, children, compact = false }: {
  repo: Repo; issue: Issue; onOpen?(s: Selected): void; panes: Pane[]; dispatches: DispatchRecord[]; onDispatch(r: DispatchRecord): void; children?: ReactNode; compact?: boolean;
}) {
  const kids = repo.children.get(issue.number) ?? [];
  const blocks = repo.blocks.get(issue.number) ?? [];
  const prs = (repo.prsOf.get(issue.number) ?? []).map(n => repo.pulls.get(n)!).filter(Boolean);
  const progress = childProgress(repo, issue.number);
  const blockers = openBlockers(repo, issue);
  const records = dispatches.filter(d => d.issue === issue.number);
  return <article className={`gh-detail ${compact ? 'compact' : ''}`}>
    <header><IssueGlyph issue={issue} /><h3>{issue.title} <span className="gh-num">#{issue.number}</span></h3></header>
    <div className="gh-meta">{issue.author} 创建于 {ago(issue.createdAt)} · 更新于 {ago(issue.updatedAt)} · 💬 {issue.comments}{issue.assignees.length ? ` · 认领：${issue.assignees.join('、')}` : ''}</div>
    {!!issue.labels.length && <div className="gh-labels">{issue.labels.map(l => <LabelChip key={l} repo={repo} name={l} />)}</div>}
    <div className="gh-actions"><DispatchButton issue={issue} panes={panes} onDispatch={onDispatch} /><a href={githubUrl(repo, 'issue', issue.number)} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a>
      {!!blockers.length && <span className="gh-warn">🔒 被 {blockers.map(b => `#${b}`).join('、')} 卡住</span>}</div>
    {!!records.length && <section><h4>派发记录</h4>{records.map((r, k) => <div key={k} className="gh-record"><span>{r.step}</span><span className="gh-ellipsis">→ {r.session}</span><small className="muted">{ago(r.at)}</small>
      {r.located ? <button title="定位到正处在该会话上的面板">定位</button> : <small className="muted" title="没有打开的面板正处在该会话上">仅记录</small>}</div>)}</section>}
    {children}
    {issue.parent && <section><h4>父 issue</h4><IssueRef repo={repo} n={issue.parent} onOpen={onOpen} note={`${childProgress(repo, issue.parent).closed}/${childProgress(repo, issue.parent).total} 已关闭`} /></section>}
    {!!kids.length && <section><h4>子 issue <small className="muted">{progress.closed}/{progress.total} 已关闭</small></h4><div className="gh-progress"><span style={{ width: `${progress.closed / progress.total * 100}%` }} /></div>
      {kids.map(n => <IssueRef key={n} repo={repo} n={n} onOpen={onOpen} />)}</section>}
    {!!issue.blockedBy.length && <section><h4>被这些卡住</h4>{issue.blockedBy.map(n => <IssueRef key={n} repo={repo} n={n} onOpen={onOpen} />)}</section>}
    {!!blocks.length && <section><h4>卡住了这些</h4>{blocks.map(n => <IssueRef key={n} repo={repo} n={n} onOpen={onOpen} />)}</section>}
    {!!prs.length && <section><h4>关联 PR</h4>{prs.map(p => <PullRow key={p.number} repo={repo} pull={p} onOpen={onOpen} />)}</section>}
    {!compact && issue.body && <section><h4>正文（节选）</h4><pre className="gh-body">{issue.body}</pre></section>}
  </article>;
}

export function PullDetail({ repo, pull, onOpen }: { repo: Repo; pull: Pull; onOpen?(s: Selected): void }) {
  return <article className="gh-detail">
    <header><PullGlyph pull={pull} /><h3>{pull.title} <span className="gh-num">#{pull.number}</span></h3></header>
    <div className="gh-meta">{pull.author} · {pull.branch} · 更新于 {ago(pull.updatedAt)} · <span className="gh-open">+{pull.additions}</span> <span className="gh-failed">−{pull.deletions}</span></div>
    <div className="gh-actions"><span>检查 <Checks pull={pull} /> {pull.checks}</span>{pull.review && <span>评审：{pull.review}</span>}<a href={githubUrl(repo, 'pull', pull.number)} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a></div>
    {!!pull.closes.length && <section><h4>关闭的 issue</h4>{pull.closes.map(n => <IssueRef key={n} repo={repo} n={n} onOpen={onOpen} />)}</section>}
    <p className="muted">PR 代码查看与 review 不在本图范围内。</p>
  </article>;
}
