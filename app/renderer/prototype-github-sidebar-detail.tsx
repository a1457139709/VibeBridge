// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// v2.1 detail: one column so the body keeps its width. It opens leftwards from the sidebar's edge, over the layout area
// (terminals are not resized). Top: parent crumb, title, one row of state + labels + blocking + dispatch; then the relation graph,
// body, sub-issues (number order, each with its blocking mark: the only place sub-issue order shows), timeline.
import React, { type PointerEvent as ReactPointerEvent } from 'react';
import { ago, childProgress, githubUrl, openBlockers, type Comment, type DispatchRecord, type Issue, type Pane, type Pull, type Repo, type Selected } from './prototype-github-sidebar-model';
import { Blocked, checksText, DispatchSplit, DispatchStatus, IssueIcon, IssuePill, Label, Progress, PullIcon, PullPill, reviewText } from './prototype-github-sidebar-common';
import { Markdown } from './prototype-github-sidebar-markdown';
import { RelationGraph } from './prototype-github-sidebar-relations';

interface Props {
  repo: Repo; selected: NonNullable<Selected>; width: number; onWidth(w: number): void; canBack: boolean; onBack(): void; onClose(): void; onOpen(s: Selected): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onDispatch(issue: number, step: string, pane: string | 'new'): void; onLocate(pane: string): void;
}

export function DetailPane(props: Props) {
  const { repo, selected, width, onWidth, canBack, onBack, onClose } = props;
  const item = selected.kind === 'issue' ? repo.issues.get(selected.number) : repo.pulls.get(selected.number);
  const resize = (e: ReactPointerEvent<HTMLDivElement>) => {
    const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
    e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing');
    const move = (m: PointerEvent) => onWidth(Math.round(Math.min(Math.max(420, right - m.clientX), 1100)));
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <section className="gh-detail" style={{ width }} aria-label="详情">
    <div className="gh-detail-resize" onPointerDown={resize} title="拖动调整宽度" />
    <header className="gh-detail-bar">
      <button disabled={!canBack} onClick={onBack} title="返回上一个">‹</button>
      <span className="gh-detail-crumb">{selected.kind === 'issue' ? 'Issue' : 'Pull request'} #{selected.number}</span>
      <span className="gh-spacer" />
      <a href={githubUrl(repo, selected.kind, selected.number)} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a>
      <button onClick={onClose} title="关闭（Esc）">×</button>
    </header>
    <div className="gh-detail-scroll">
      {!item ? <p className="gh-empty">#{selected.number} 不在快照里</p>
        : selected.kind === 'issue' ? <IssueDetail {...props} issue={item as Issue} /> : <PullDetail {...props} pull={item as Pull} />}
    </div>
  </section>;
}

function Timeline({ repo, comments, onOpen }: { repo: Repo; comments: Comment[]; onOpen(s: Selected): void }) {
  return <>{comments.map((c, k) => <article key={k} className="gh-card">
    <header><b>{c.author}</b> <span>{ago(c.at)}</span></header>
    <Markdown repo={repo} source={c.body} onOpen={onOpen} />
  </article>)}</>;
}

function IssueDetail({ repo, issue: i, onOpen, panes, dispatches, onDispatch, onLocate }: Props & { issue: Issue }) {
  const kids = (repo.children.get(i.number) ?? []).map(n => repo.issues.get(n)).filter((k): k is Issue => !!k);
  const parent = i.parent ? repo.issues.get(i.parent) : undefined;
  const blockers = openBlockers(repo, i);
  const records = dispatches.filter(d => d.issue === i.number);
  const progress = childProgress(repo, i.number);
  return <div className="gh-doc">
    {parent && <button className="gh-parent" onClick={() => onOpen({ kind: 'issue', number: parent.number })}><IssueIcon issue={parent} size={12} /><span className="gh-ellipsis">{parent.title}</span><span className="gh-row-num">#{parent.number}</span>
      <Progress {...childProgress(repo, parent.number)} /></button>}
    <h2>{i.title} <span className="gh-row-num">#{i.number}</span></h2>
    <div className="gh-doc-head"><IssuePill issue={i} />
      {i.labels.map(l => <Label key={l} repo={repo} name={l} />)}
      <span className="gh-spacer" />
      {!!blockers.length && <Blocked repo={repo} by={blockers} />}
      {i.state === 'open' && <DispatchSplit issue={i} panes={panes} weak={!!blockers.length} onDispatch={(step, pane) => onDispatch(i.number, step, pane)} />}
    </div>
    {!!records.length && <div className="gh-doc-records">{records.map((r, k) => <span key={k} className="gh-record"><code>{r.step}</code><span>{ago(r.at)}</span><DispatchStatus records={[r]} panes={panes} onLocate={onLocate} /></span>)}</div>}
    <RelationGraph repo={repo} issue={i} onOpen={onOpen} />
    <div className="gh-doc-main">
      <article className="gh-card"><header><b>{i.author}</b> <span>{ago(i.createdAt)}</span></header><Markdown repo={repo} source={i.body} onOpen={onOpen} /></article>
      {!!kids.length && <section className="gh-box"><header>子 issue <Progress {...progress} /></header>
        {kids.map(k => { const b = openBlockers(repo, k); return <div role="button" tabIndex={0} key={k.number} className={`gh-ref ${k.state === 'closed' ? 'closed' : ''}`} onClick={() => onOpen({ kind: 'issue', number: k.number })} title={k.title}>
          <IssueIcon issue={k} /><span className="gh-ellipsis">{k.title}</span><span className="gh-row-num">#{k.number}</span>{!!b.length && <Blocked repo={repo} by={b} />}
          {dispatches.some(d => d.issue === k.number) && <DispatchStatus records={dispatches.filter(d => d.issue === k.number)} panes={panes} onLocate={onLocate} />}</div>; })}
      </section>}
      <Timeline repo={repo} comments={i.comments} onOpen={onOpen} />
    </div>
  </div>;
}

function PullDetail({ repo, pull: p, onOpen }: Props & { pull: Pull }) {
  const review = reviewText(p.review);
  const checks = checksText(p.checks);
  return <div className="gh-doc">
    <h2>{p.title} <span className="gh-row-num">#{p.number}</span></h2>
    <div className="gh-doc-meta"><PullPill pull={p} /><span><b>{p.author}</b> 想把 <code className="gh-branch">{p.branch}</code> 合并进来 · {ago(p.createdAt)}</span></div>
    <div className="gh-doc-actions">
      <span><span className="gh-open">+{p.additions}</span> <span className="gh-failed">−{p.deletions}</span> · {p.changedFiles} 个文件</span>
      <a href={`${githubUrl(repo, 'pull', p.number)}/files`} target="_blank" rel="noreferrer">查看改动 ↗</a>
      <span className={`gh-${checks.tone}`}>{checks.text}</span>{review && <span className={`gh-${review.tone}`}>{review.text}</span>}
    </div>
    {!!p.closes.length && <div className="gh-closes">关闭 {p.closes.map(n => { const i = repo.issues.get(n); return i
      ? <button key={n} className="gh-ref inline" onClick={() => onOpen({ kind: 'issue', number: n })} title={i.title}><IssueIcon issue={i} size={12} /><span className="gh-ellipsis">{i.title}</span><span className="gh-row-num">#{n}</span></button>
      : <span key={n}>#{n}</span>; })}</div>}
    <div className="gh-doc-main">
      <article className="gh-card"><header><b>{p.author}</b> <span>{ago(p.createdAt)}</span></header><Markdown repo={repo} source={p.body} onOpen={onOpen} /></article>
      <section className="gh-box"><header><PullIcon pull={p} size={14} />检查 <span className={`gh-${checks.tone}`}>{checks.text}</span></header>
        {p.checkRuns.map(c => { const t = checksText(c.state); return <div key={c.name} className="gh-check-row"><span className="gh-ellipsis">{c.name}</span><span className={`gh-${t.tone}`}>{t.text}</span></div>; })}
        {!p.checkRuns.length && <p className="muted">没有检查</p>}</section>
      {p.reviews.filter(r => r.body || r.state !== 'commented').map((r, k) => <article key={k} className="gh-card"><header><b>{r.author}</b> <span>{reviewText(r.state)?.text ?? r.state} · {ago(r.at)}</span></header>
        {r.body && <Markdown repo={repo} source={r.body} onOpen={onOpen} />}</article>)}
      <Timeline repo={repo} comments={p.comments} onOpen={onOpen} />
    </div>
  </div>;
}
