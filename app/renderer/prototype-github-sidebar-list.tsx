// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Variant「列表 + 局部关系图」: GitHub-style list with search / labels / sort, drill into a detail whose top is a one-hop graph.
import React, { useState } from 'react';
import { ago, childProgress, issueMatches, openBlockers, pullMatches, sorted, type DispatchRecord, type Filter, type Issue, type Repo, type Selected } from './prototype-github-sidebar-model';
import { Checks, Filters, IssueDetail, IssueGlyph, LabelChip, PullDetail, PullGlyph, type Pane } from './prototype-github-sidebar-common';

interface Props {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; selected: Selected; setSelected(s: Selected): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onDispatch(r: DispatchRecord): void;
}

export function ListVariant({ repo, filter, setFilter, selected, setSelected, panes, dispatches, onDispatch }: Props) {
  const [tab, setTab] = useState<'issue' | 'pull'>('issue');
  const all = repo.snapshot.issues;
  const textOnly = { ...filter, state: 'all' as const };
  const counts = tab === 'issue'
    ? { open: all.filter(i => i.state === 'open' && issueMatches(i, textOnly)).length, closed: all.filter(i => i.state === 'closed' && issueMatches(i, textOnly)).length }
    : { open: repo.snapshot.pulls.filter(p => pullMatches(repo, p, { ...filter, state: 'open' })).length, closed: repo.snapshot.pulls.filter(p => pullMatches(repo, p, { ...filter, state: 'closed' })).length };

  if (selected) {
    const back = <button className="gh-back" onClick={() => setSelected(undefined)}>‹ 返回列表</button>;
    if (selected.kind === 'pull') { const p = repo.pulls.get(selected.number); return <div className="gh-scroll">{back}{p && <PullDetail repo={repo} pull={p} onOpen={setSelected} />}</div>; }
    const issue = repo.issues.get(selected.number);
    return <div className="gh-scroll">{back}{issue && <IssueDetail repo={repo} issue={issue} onOpen={setSelected} panes={panes} dispatches={dispatches} onDispatch={onDispatch}>
      <section><h4>关系 <small className="muted">一跳以内</small></h4><EgoGraph repo={repo} issue={issue} onOpen={setSelected} /></section>
    </IssueDetail>}</div>;
  }

  const issues = sorted(all.filter(i => issueMatches(i, filter)), filter.sort);
  const pulls = sorted(repo.snapshot.pulls.filter(p => pullMatches(repo, p, filter)), filter.sort);
  return <>
    <div className="gh-tabs"><button className={tab === 'issue' ? 'on' : ''} onClick={() => setTab('issue')}>Issues</button><button className={tab === 'pull' ? 'on' : ''} onClick={() => setTab('pull')}>Pull requests</button></div>
    <Filters repo={repo} filter={filter} setFilter={setFilter} counts={counts} />
    <div className="gh-scroll gh-list">
      {tab === 'issue' && issues.map(i => <IssueItem key={i.number} repo={repo} issue={i} dispatched={dispatches.some(d => d.issue === i.number)} onClick={() => setSelected({ kind: 'issue', number: i.number })}
        onLabel={l => setFilter(f => f.labels.includes(l) ? f : { ...f, labels: [...f.labels, l] })} />)}
      {tab === 'pull' && pulls.map(p => <button key={p.number} className="gh-item" onClick={() => setSelected({ kind: 'pull', number: p.number })}>
        <PullGlyph pull={p} /><div className="gh-item-main"><div className="gh-item-title">{p.title}</div>
          <div className="gh-item-meta">#{p.number} · {p.author} · 更新于 {ago(p.updatedAt)}{p.closes.length ? ` · 关闭 ${p.closes.map(n => `#${n}`).join(' ')}` : ''}</div></div>
        <div className="gh-item-side"><Checks pull={p} /></div></button>)}
      {!(tab === 'issue' ? issues : pulls).length && <p className="gh-empty">没有符合条件的{tab === 'issue' ? ' issue' : ' PR'}</p>}
    </div>
  </>;
}

function IssueItem({ repo, issue: i, dispatched, onClick, onLabel }: { repo: Repo; issue: Issue; dispatched: boolean; onClick(): void; onLabel(l: string): void }) {
  const progress = childProgress(repo, i.number);
  const prs = (repo.prsOf.get(i.number) ?? []).map(n => repo.pulls.get(n)!).filter(Boolean);
  const blocked = openBlockers(repo, i).length > 0;
  return <button className="gh-item" onClick={onClick}>
    <IssueGlyph issue={i} />
    <div className="gh-item-main">
      <div className="gh-item-title">{i.title}</div>
      {!!i.labels.length && <div className="gh-labels">{i.labels.map(l => <LabelChip key={l} repo={repo} name={l} onClick={() => onLabel(l)} />)}</div>}
      <div className="gh-item-meta">#{i.number} · {i.author} · 更新于 {ago(i.updatedAt)}{i.parent ? ` · 属于 #${i.parent}` : ''}</div>
    </div>
    <div className="gh-item-side">
      {dispatched && <span className="gh-badge" title="有派发记录">已派发</span>}
      {blocked && <span title="被开放的 issue 卡住">🔒</span>}
      {!!progress.total && <span className="muted" title="子 issue 已关闭 / 总数">◔ {progress.closed}/{progress.total}</span>}
      {prs.map(p => <span key={p.number} title={`#${p.number} ${p.title}`}><PullGlyph pull={p} /></span>)}
      {!!i.comments && <span className="muted">💬 {i.comments}</span>}
    </div>
  </button>;
}

/** One hop around an issue: blockers on the left, parent / self / children down the middle, what it blocks and its PRs on the right. */
function EgoGraph({ repo, issue, onOpen }: { repo: Repo; issue: Issue; onOpen(s: Selected): void }) {
  const [hover, setHover] = useState<string>();
  type N = { key: string; kind: 'issue' | 'pull'; n: number; title: string; tone: string; x: number; y: number; edge: 'parent' | 'child' | 'blocks' | 'pr' | 'self'; dir: 'in' | 'out' };
  const tone = (kind: 'issue' | 'pull', n: number) => {
    if (kind === 'pull') { const p = repo.pulls.get(n); return p ? ({ open: 'open', draft: 'skipped', merged: 'done', closed: 'failed' }[p.state]) : 'skipped'; }
    const i = repo.issues.get(n); return !i ? 'skipped' : i.state === 'open' ? 'open' : i.reason === 'not_planned' ? 'skipped' : 'done';
  };
  const title = (kind: 'issue' | 'pull', n: number) => (kind === 'pull' ? repo.pulls.get(n)?.title : repo.issues.get(n)?.title) ?? '（不在快照里）';
  const left = issue.blockedBy.map(n => ({ kind: 'issue' as const, n, edge: 'blocks' as const, dir: 'in' as const }));
  const right = [...(repo.blocks.get(issue.number) ?? []).map(n => ({ kind: 'issue' as const, n, edge: 'blocks' as const, dir: 'out' as const })),
    ...(repo.prsOf.get(issue.number) ?? []).map(n => ({ kind: 'pull' as const, n, edge: 'pr' as const, dir: 'in' as const }))];
  const kids = (repo.children.get(issue.number) ?? []).map(n => ({ kind: 'issue' as const, n, edge: 'child' as const, dir: 'out' as const }));
  const W = 300, row = 24, cols = Math.min(4, Math.max(1, kids.length));
  const sideH = Math.max(left.length, right.length) * row;
  const selfY = (issue.parent ? 48 : 18) + Math.max(0, sideH / 2 - row / 2);
  const kidRows = Math.ceil(kids.length / cols);
  const H = selfY + 28 + kidRows * row + 10;
  const nodes: N[] = [];
  const place = (list: { kind: 'issue' | 'pull'; n: number; edge: N['edge']; dir: N['dir'] }[], x: number) => list.forEach((e, k) =>
    nodes.push({ ...e, key: `${e.kind}${e.n}`, title: title(e.kind, e.n), tone: tone(e.kind, e.n), x, y: selfY - (list.length - 1) * row / 2 + k * row }));
  if (issue.parent) nodes.push({ key: `issue${issue.parent}`, kind: 'issue', n: issue.parent, title: title('issue', issue.parent), tone: tone('issue', issue.parent), x: W / 2, y: 16, edge: 'parent', dir: 'in' });
  place(left, 40); place(right, W - 40);
  kids.forEach((e, k) => nodes.push({ ...e, key: `issue${e.n}`, title: title('issue', e.n), tone: tone('issue', e.n), x: cols === 1 ? W / 2 : 60 + (k % cols) * ((W - 120) / (cols - 1)), y: selfY + 36 + Math.floor(k / cols) * row }));
  const hovered = nodes.find(n => n.key === hover);
  if (!nodes.length) return <p className="muted gh-ego-empty">没有父子、依赖或关联 PR：它是一个孤立的点。</p>;
  return <div className="gh-ego">
    <svg viewBox={`0 0 ${W} ${H}`} width="100%">
      <defs><marker id="ego-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" className="gh-arrow" /></marker></defs>
      {nodes.map(n => {
        const [x1, y1, x2, y2] = n.dir === 'in' ? [n.x, n.y, W / 2, selfY] : [W / 2, selfY, n.x, n.y];
        return <line key={`e-${n.key}`} x1={x1} y1={y1} x2={x2} y2={y2} className={`gh-edge gh-edge-${n.edge === 'child' ? 'parent' : n.edge === 'pr' ? 'closes' : n.edge}`} markerEnd={n.edge === 'blocks' ? 'url(#ego-arrow)' : undefined} />;
      })}
      <g className="gh-ego-self"><rect x={W / 2 - 26} y={selfY - 10} width="52" height="20" rx="10" /><text x={W / 2} y={selfY + 4}>#{issue.number}</text></g>
      {nodes.map(n => <g key={n.key} className={`gh-ego-node gh-${n.tone} ${n.kind}`} onMouseEnter={() => setHover(n.key)} onMouseLeave={() => setHover(undefined)} onClick={() => onOpen({ kind: n.kind, number: n.n })}>
        <rect x={n.x - 22} y={n.y - 9} width="44" height="18" rx={n.kind === 'pull' ? 3 : 9} /><text x={n.x} y={n.y + 4}>#{n.n}</text></g>)}
    </svg>
    <div className="gh-ego-caption">{hovered ? <><b>#{hovered.n}</b> {hovered.title}</> : <span className="muted">左：卡住它的 · 上：父 · 下：子 · 右：它卡住的与 PR（悬停看标题，点击跳转）</span>}</div>
  </div>;
}
