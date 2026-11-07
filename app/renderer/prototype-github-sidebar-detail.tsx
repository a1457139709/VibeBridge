// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// v2.1 detail: one column so the body keeps its width. It opens leftwards from the sidebar's edge, over the layout area
// (terminals are not resized). Top: parent crumb, title, one row of state + labels + blocking + dispatch; then the relation graph,
// body, sub-issues (number order, each with its blocking mark: the only place sub-issue order shows), timeline.
import React, { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { agentIcons } from './agent-icons';
import { ago, childProgress, githubUrl, openBlockers, type Comment, type DispatchRecord, type Issue, type Pane, type Pull, type Repo, type Selected } from './prototype-github-sidebar-model';
import { Blocked, checksText, DispatchStatus, IssueIcon, IssuePill, Label, Progress, PullIcon, PullPill, reviewText } from './prototype-github-sidebar-common';
import { Markdown } from './prototype-github-sidebar-markdown';
import { RelationGraph } from './prototype-github-sidebar-relations';

interface Props {
  repo: Repo; selected: NonNullable<Selected>; width: number; onWidth(w: number): void; canBack: boolean; onBack(): void; onClose(): void; onOpen(s: Selected): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onLocate(pane: string): void; dispatchButton(issue: Issue, weak: boolean): ReactNode;
  /** Prototype switch for #156: what the next direct action does. */ writes: 'ok' | 'fail' | 'readonly';
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
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.focus({ preventScroll: true }); scroller.current?.scrollTo({ top: 0 }); }, [selected.kind, selected.number]);
  // #157: focus lands in the detail; ↑/↓ scroll the body (native on the focused scroller), Tab walks links and buttons, → or Esc go back to the row.
  const keydown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || (e.target as HTMLElement).closest('input, textarea, .wb-menu')) return;
    if (e.key === 'Escape' || (e.key === 'ArrowRight' && !e.metaKey && !e.altKey)) { e.preventDefault(); onClose(); }
  };
  return <section className="gh-detail" style={{ width }} aria-label="详情" onKeyDown={keydown}>
    <div className="gh-detail-resize" onPointerDown={resize} title="拖动调整宽度" />
    <header className="gh-detail-bar">
      <button disabled={!canBack} onClick={onBack} title="返回上一个">‹</button>
      <span className="gh-detail-crumb">{selected.kind === 'issue' ? 'Issue' : 'Pull request'} #{selected.number}</span>
      <span className="gh-spacer" />
      <a href={githubUrl(repo, selected.kind, selected.number)} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a>
      <button onClick={onClose} title="收起（→ 或 Esc）">×</button>
    </header>
    <div className="gh-detail-scroll" ref={scroller} tabIndex={-1}>
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

function IssueDetail({ repo, issue: i, onOpen, panes, dispatches, onLocate, dispatchButton, writes }: Props & { issue: Issue }) {
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
      {i.state === 'open' && dispatchButton(i, !!blockers.length)}
    </div>
    {!!records.length && <Records records={records} panes={panes} onLocate={onLocate} folded={i.state === 'closed'} />}
    <RelationGraph repo={repo} issue={i} onOpen={onOpen} />
    <ClosingPulls repo={repo} issue={i} onOpen={onOpen} />
    <div className="gh-doc-main">
      <article className="gh-card"><header><b>{i.author}</b> <span>{ago(i.createdAt)}</span></header><Markdown repo={repo} source={i.body} onOpen={onOpen} /></article>
      {!!kids.length && <section className="gh-box"><header>子 issue <Progress {...progress} /></header>
        {kids.map(k => { const b = openBlockers(repo, k); return <div role="button" tabIndex={0} key={k.number} className={`gh-ref ${k.state === 'closed' ? 'closed' : ''}`} onClick={() => onOpen({ kind: 'issue', number: k.number })} title={k.title}>
          <IssueIcon issue={k} /><span className="gh-ellipsis">{k.title}</span><span className="gh-row-num">#{k.number}</span>{!!b.length && <Blocked repo={repo} by={b} />}
          {dispatches.some(d => d.issue === k.number) && <DispatchStatus records={dispatches.filter(d => d.issue === k.number)} panes={panes} onLocate={onLocate} />}</div>; })}
      </section>}
      <Timeline repo={repo} comments={i.comments} onOpen={onOpen} />
      <IssueActions issue={i} writes={writes} />
    </div>
  </div>;
}

/** #142: newest first — time, Agent type, session title (jumps when a pane is on that session), the text sent (folded). Closed issue: folded as a whole. */
function Records({ records, panes, onLocate, folded }: { records: DispatchRecord[]; panes: Pane[]; onLocate(pane: string): void; folded: boolean }) {
  const [open, setOpen] = useState(!folded);
  const [shown, setShown] = useState<Set<number>>(new Set());
  return <section className="gh-box wb-records"><header><button className="gh-text-button" onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'} 派发记录 ({records.length})</button></header>
    {open && [...records].reverse().map((r, k) => { const pane = panes.find(p => p.id === r.pane); return <div key={k} className="wb-record">
      <span className="muted">{ago(r.at)}</span><span className="agent-mark">{agentIcons[r.agent]}</span>
      {pane ? <button className="gh-ref inline" onClick={() => onLocate(pane.id)} title="定位到正处在这个会话上的面板"><span className="gh-ellipsis">{pane.title}</span></button> : <span className="muted gh-ellipsis" title="没有面板处在这个会话上">{r.title}</span>}
      {pane && <DispatchStatus records={[r]} panes={panes} onLocate={onLocate} />}
      <button className="gh-text-button" onClick={() => setShown(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>{shown.has(k) ? '收起指令' : `${r.command} ▸`}</button>
      {shown.has(k) && <code className="wb-record-text">{r.text}</code>}
    </div>; })}
  </section>;
}

/** #156: close (completed / not planned) or reopen, one click, at the bottom like GitHub. No write permission: no buttons. Failure: reason + retry under the button. */
function IssueActions({ issue, writes }: { issue: Issue; writes: Props['writes'] }) {
  const [state, setState] = useState<{ run?: string; error?: string; done?: string }>({});
  const [menu, setMenu] = useState(false);
  useEffect(() => setState({}), [issue.number]);
  if (writes === 'readonly') return <p className="muted wb-actions-note">（原型：没有写权限时这里不显示任何按钮）</p>;
  const run = (what: string) => { setMenu(false); setState({ run: what }); setTimeout(() => setState(writes === 'fail' ? { error: `${what}失败：HTTP 502（GitHub 暂时不可用）`, run: undefined } : { done: what }), 700); };
  const closed = issue.state === 'closed';
  return <div className="wb-issue-actions">
    {state.done ? <span className="muted">已{state.done}（原型：不会真的改动 GitHub，真实实现会触发一次刷新）</span> : closed
      ? <button className="gh-btn" disabled={!!state.run} onClick={() => run('重新打开')}>{state.run ? '处理中…' : '重新打开 issue'}</button>
      : <span className="gh-split detail-inline">
        <button className="gh-split-main" disabled={!!state.run} onClick={() => run('关闭为已完成')}>{state.run ? '处理中…' : '关闭 issue'}</button>
        <button className="gh-split-more" disabled={!!state.run} onClick={() => setMenu(m => !m)}>▾</button>
        {menu && <div className="gh-pop wb-close-pop"><button onClick={() => run('关闭为已完成')}>关闭为已完成</button><button onClick={() => run('关闭为不做')}>关闭为不做（not planned）</button></div>}
      </span>}
    {state.error && <div className="wb-action-error">{state.error} <button className="gh-text-button" onClick={() => run(state.error!.split('失败')[0])}>重试</button></div>}
  </div>;
}

// v3.1 (#159): GitHub's order in one column. Head: state, head → base, the issues GitHub will close on merge (closingIssuesReferences,
// never parsed by us). Then body, timeline of comments and review summaries (inline code comments only counted), merge box last:
// review, checks, conflicts, then merge / close. No approve button, no reviewer list, no diff or size.
function PullDetail({ repo, pull: p, onOpen }: Props & { pull: Pull }) {
  const timeline = [
    ...p.comments.map(c => ({ ...c, state: undefined as string | undefined })),
    ...p.reviews.filter(r => r.body).map(r => ({ author: r.author, body: r.body, at: r.at, state: r.state })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return <div className="gh-doc">
    <h2>{p.title} <span className="gh-row-num">#{p.number}</span></h2>
    <div className="gh-doc-meta"><PullPill pull={p} /><span><b>{p.author}</b> 想把 <code className="gh-branch">{p.branch}</code> 合并进 <code className="gh-branch">{p.base ?? 'main'}</code> · {ago(p.createdAt)}</span></div>
    <div className="gh-doc-actions">
      <a href={`${githubUrl(repo, 'pull', p.number)}/files`} target="_blank" rel="noreferrer">在 GitHub 查看改动 ↗</a>
      {(p.labels ?? []).map(l => <Label key={l} repo={repo} name={l} />)}
    </div>
    {!!p.closes.length && <div className="gh-closes">合并后关闭 {p.closes.map(n => { const i = repo.issues.get(n); return i
      ? <button key={n} className="gh-ref inline" onClick={() => onOpen({ kind: 'issue', number: n })} title={i.title}><IssueIcon issue={i} size={12} /><span className="gh-ellipsis">{i.title}</span><span className="gh-row-num">#{n}</span></button>
      : <span key={n}>#{n}</span>; })}</div>}
    <div className="gh-doc-main">
      <article className="gh-card"><header><b>{p.author}</b> <span>{ago(p.createdAt)}</span></header><Markdown repo={repo} source={p.body} onOpen={onOpen} /></article>
      {timeline.map((c, k) => { const r = c.state && reviewText(c.state); return <article key={k} className="gh-card">
        <header><b>{c.author}</b> {r && <span className={`gh-pr-chip gh-${r.tone}`}>{r.text}</span>} <span>{ago(c.at)}</span></header>
        <Markdown repo={repo} source={c.body} onOpen={onOpen} /></article>; })}
      {!!p.codeComments && <div className="gh-code-comments">💬 {p.codeComments} 条代码评论 <a href={`${githubUrl(repo, 'pull', p.number)}/files`} target="_blank" rel="noreferrer">在 GitHub 查看 ↗</a></div>}
      <MergeBox repo={repo} pull={p} />
    </div>
  </div>;
}

type Step = 'idle' | 'confirm' | 'running' | 'done';
/** Q4 + Q12: GitHub's merge box, review and checks in the same block. Each requirement on its own row; buttons grey out with the reason written next to them. */
function MergeBox({ repo, pull: p }: { repo: Repo; pull: Pull }) {
  const [showPassed, setShowPassed] = useState(false);
  const [merge, setMerge] = useState<Step>('idle');
  const [method, setMethod] = useState(p.mergeMethods?.[0] ?? 'merge');
  const [methodsOpen, setMethodsOpen] = useState(false);
  const run = (set: (s: Step) => void) => { set('running'); setTimeout(() => set('done'), 700); };
  if (p.state === 'merged' || p.state === 'closed') return <section className="gh-merge"><div className="gh-merge-row"><PullIcon pull={p} />
    {p.state === 'merged' ? '已合并' : '已关闭，没有合并'}<span className="gh-spacer" />{p.state === 'closed' && <button className="gh-btn">重新打开</button>}</div></section>;

  const runs = p.checkRuns.map(c => ({ ...c, t: checksText(c.state) }));
  const failed = runs.filter(c => c.t.kind === 'failed'), pending = runs.filter(c => c.t.kind === 'pending'), passed = runs.filter(c => c.t.kind === 'passed');
  const requiredBad = [...failed, ...pending].filter(c => c.required);
  const reviewOk = p.review === 'approved' || !p.requiredApprovals;
  const blocks = [
    p.state === 'draft' && '这是草稿',
    p.mergeable === 'conflicting' && '有冲突',
    requiredBad.length && `必需的检查${failed.some(c => c.required) ? '没通过' : '还在运行'}`,
    !reviewOk && (p.review === 'changes_requested' ? '有人要求修改' : `还缺 ${p.requiredApprovals} 个批准`),
  ].filter(Boolean) as string[];
  const methodName: Record<string, string> = { merge: '创建合并提交', squash: '压缩合并', rebase: '变基合并' };
  const reviewRow = p.review === 'approved' ? { tone: 'open', mark: '✓', text: '已批准' }
    : p.review === 'changes_requested' ? { tone: 'failed', mark: '✗', text: '有人要求修改，需要重新 review' }
      : { tone: p.requiredApprovals ? 'pending' : 'skipped', mark: '●', text: p.requiredApprovals ? `需要至少 ${p.requiredApprovals} 个批准` : '不要求 review' };
  const checkRow = !runs.length ? { tone: 'skipped', mark: '–', text: '没有检查' }
    : { tone: failed.length ? 'failed' : pending.length ? 'pending' : 'open', mark: failed.length ? '✗' : pending.length ? '●' : '✓',
      text: [failed.length && `${failed.length} 项失败`, pending.length && `${pending.length} 项进行中`, passed.length && `${passed.length} 项通过`].filter(Boolean).join('，') };
  const check = (c: typeof runs[number]) => <div key={c.name} className="gh-merge-check">
    <span className={`gh-${c.t.tone}`}>{c.t.mark}</span><span className="gh-ellipsis">{c.name}</span>{c.required && <span className="gh-required">必需</span>}
    <span className="gh-spacer" /><span className={`gh-${c.t.tone}`}>{c.t.text}</span><a href={c.url} target="_blank" rel="noreferrer">日志 ↗</a></div>;

  return <section className="gh-merge">
    <div className="gh-merge-row"><span className={`gh-${reviewRow.tone}`}>{reviewRow.mark}</span><b>Review</b><span>{reviewRow.text}</span></div>
    <div className="gh-merge-row column">
      <div className="gh-merge-row-head"><span className={`gh-${checkRow.tone}`}>{checkRow.mark}</span><b>检查</b><span>{checkRow.text}</span></div>
      {[...failed, ...pending].map(check)}
      {!!passed.length && <button className="gh-text-button gh-merge-fold" onClick={() => setShowPassed(v => !v)}>{showPassed ? '收起通过的检查' : `${passed.length} 项通过 ▸`}</button>}
      {showPassed && passed.map(check)}
    </div>
    <div className="gh-merge-row">{p.mergeable === 'conflicting'
      ? <><span className="gh-failed">✗</span><b>冲突</b><span>和 <code className="gh-branch">{p.base}</code> 有冲突，需要先解决</span></>
      : <><span className="gh-open">✓</span><b>冲突</b><span>没有冲突</span></>}</div>
    {p.state === 'draft' && <div className="gh-merge-row"><span className="gh-skipped">●</span><b>草稿</b><span>标记为可以 review 之后才能合并（在 GitHub 上操作）</span></div>}

    <div className="gh-merge-actions">
      {p.mergeQueue
        ? <span className="gh-merge-why"><button className="gh-btn" disabled>合并</button>仓库要求通过 merge queue 合并，<a href={githubUrl(repo, 'pull', p.number)} target="_blank" rel="noreferrer">在 GitHub 打开 ↗</a></span>
        : <span className="gh-merge-why">
          <span className={`gh-split detail ${blocks.length ? 'weak' : ''}`}>
            <button className="gh-split-main" disabled={!!blocks.length || merge === 'running'} onClick={() => merge === 'confirm' ? run(setMerge) : setMerge('confirm')}>
              {merge === 'confirm' ? `确认${methodName[method]}` : merge === 'running' ? '合并中…' : methodName[method]}</button>
            <button className="gh-split-more" disabled={!!blocks.length} onClick={() => setMethodsOpen(o => !o)}>▾</button>
            {methodsOpen && <div className="gh-pop">{p.mergeMethods?.map(m => <button key={m} className={m === method ? 'on' : ''} onClick={() => { setMethod(m); setMethodsOpen(false); setMerge('idle'); }}>{methodName[m]}</button>)}</div>}
          </span>
          {!!blocks.length && <span className="muted">不能合并：{blocks.join('、')}</span>}
          {merge === 'done' && <span className="muted">（原型：不会真的合并，真实实现会触发一次刷新）</span>}
        </span>}
      <span className="gh-spacer" />
      <button className="gh-btn">关闭 PR</button>
    </div>
  </section>;
}

/** v3.1 (#159): PRs GitHub will close this issue with, kept out of the issue-only graph and drawn as PRs. */
function ClosingPulls({ repo, issue, onOpen }: { repo: Repo; issue: Issue; onOpen(s: Selected): void }) {
  const pulls = (repo.prsOf.get(issue.number) ?? []).map(n => repo.pulls.get(n)).filter((p): p is Pull => !!p);
  if (!pulls.length) return null;
  return <section className="gh-closing-pulls"><header>合并后关闭本 issue 的 PR</header>
    {pulls.map(p => { const c = checksText(p.checks); return <button key={p.number} className="gh-closing-pull" onClick={() => onOpen({ kind: 'pull', number: p.number })} title={p.title}>
      <PullIcon pull={p} size={14} /><span className="gh-row-num">#{p.number}</span><span className="gh-ellipsis">{p.title}</span>
      {(p.state === 'open' || p.state === 'draft') && p.checks !== 'none' && <span className={`gh-pr-chip gh-${c.tone}`}>{c.mark} {c.text}</span>}</button>; })}
  </section>;
}
