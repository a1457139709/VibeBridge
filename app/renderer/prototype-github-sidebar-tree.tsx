// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Variant「树形大纲」: issues indented under their parent; closed children fold into a count row; detail opens inline.
import React, { useMemo, useState } from 'react';
import { childProgress, issueMatches, openBlockers, pullMatches, sorted, type DispatchRecord, type Filter, type Issue, type Repo, type Selected } from './prototype-github-sidebar-model';
import { Checks, Filters, IssueDetail, IssueGlyph, LabelChip, PullDetail, PullGlyph, type Pane } from './prototype-github-sidebar-common';

interface Props {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; selected: Selected; setSelected(s: Selected): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onDispatch(r: DispatchRecord): void;
}

export function TreeVariant({ repo, filter, setFilter, selected, setSelected, panes, dispatches, onDispatch }: Props) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [shownClosed, setShownClosed] = useState<Set<number>>(new Set());
  const [loose, setLoose] = useState(false);
  // An issue is visible when it matches or any descendant matches; ancestors of a match stay as context.
  const visible = useMemo(() => {
    const memo = new Map<number, boolean>();
    const walk = (n: number): boolean => {
      if (memo.has(n)) return memo.get(n)!;
      memo.set(n, false);
      const i = repo.issues.get(n)!;
      const v = issueMatches(i, filter) || (repo.children.get(n) ?? []).some(walk);
      memo.set(n, v); return v;
    };
    for (const i of repo.snapshot.issues) walk(i.number);
    return memo;
  }, [repo, filter]);
  const roots = sorted(repo.snapshot.issues.filter(i => !i.parent || !repo.issues.has(i.parent)), filter.sort);
  const withKids = roots.filter(i => repo.children.has(i.number) && visible.get(i.number));
  const standalone = roots.filter(i => !repo.children.has(i.number) && visible.get(i.number));
  const pulls = sorted(repo.snapshot.pulls.filter(p => !p.closes.some(n => repo.issues.has(n)) && pullMatches(repo, p, filter)), filter.sort);
  const flip = (set: Set<number>, n: number) => { const next = new Set(set); next.has(n) ? next.delete(n) : next.add(n); return next; };
  const select = (s: Selected) => setSelected(selected && s && selected.kind === s.kind && selected.number === s.number ? undefined : s);

  const row = (i: Issue, depth: number): React.ReactNode => {
    const kids = (repo.children.get(i.number) ?? []).map(n => repo.issues.get(n)!).filter(Boolean);
    const shownKids = kids.filter(k => visible.get(k.number));
    // Closed children that the state filter would hide fold into one count row instead of disappearing.
    const hiddenClosed = filter.state === 'open' ? kids.filter(k => k.state === 'closed' && issueMatches(k, { ...filter, state: 'closed' })) : [];
    const open = !collapsed.has(i.number);
    const isSel = selected?.kind === 'issue' && selected.number === i.number;
    const progress = childProgress(repo, i.number);
    const blockers = openBlockers(repo, i);
    const prs = (repo.prsOf.get(i.number) ?? []).map(n => repo.pulls.get(n)!).filter(Boolean);
    const context = !issueMatches(i, filter);
    return <React.Fragment key={i.number}>
      <div className={`gh-tree-row ${isSel ? 'selected' : ''} ${context ? 'gh-context' : ''}`} style={{ '--depth': depth } as React.CSSProperties} onClick={() => select({ kind: 'issue', number: i.number })}>
        <span className="gh-tree-guides" />
        {kids.length ? <button className="gh-disclosure" onClick={e => { e.stopPropagation(); setCollapsed(c => flip(c, i.number)); }}>{open ? '⌄' : '›'}</button> : <span className="gh-disclosure" />}
        <IssueGlyph issue={i} /><span className="gh-num">#{i.number}</span><span className="gh-ellipsis">{i.title}</span>
        <span className="gh-tree-side">
          {dispatches.some(d => d.issue === i.number) && <span className="gh-badge">已派发</span>}
          {!!blockers.length && <span title={`被 ${blockers.map(b => `#${b}`).join('、')} 卡住`}>🔒</span>}
          {prs.slice(0, 3).map(p => <span key={p.number} title={`#${p.number} ${p.title}`}><PullGlyph pull={p} /></span>)}
          {!!progress.total && <small className="muted">{progress.closed}/{progress.total}</small>}
        </span>
      </div>
      {isSel && <div className="gh-tree-detail" style={{ '--depth': depth } as React.CSSProperties}>
        <IssueDetail repo={repo} issue={i} compact onOpen={s => { if (s?.kind === 'issue') reveal(s.number); setSelected(s); }} panes={panes} dispatches={dispatches} onDispatch={onDispatch} /></div>}
      {open && shownKids.map(k => row(k, depth + 1))}
      {open && !!hiddenClosed.length && (shownClosed.has(i.number)
        ? <>{hiddenClosed.map(k => row(k, depth + 1))}<button className="gh-tree-fold" style={{ '--depth': depth + 1 } as React.CSSProperties} onClick={() => setShownClosed(s => flip(s, i.number))}>收起已关闭</button></>
        : <button className="gh-tree-fold" style={{ '--depth': depth + 1 } as React.CSSProperties} onClick={() => setShownClosed(s => flip(s, i.number))}>✓ 已关闭 {hiddenClosed.length} 个 ›</button>)}
    </React.Fragment>;
  };
  // Jumping to a related issue expands its ancestors so the row is on screen.
  const reveal = (n: number) => setCollapsed(c => { const next = new Set(c); let p = repo.issues.get(n)?.parent; while (p) { next.delete(p); p = repo.issues.get(p)?.parent; } return next; });

  const selPull = selected?.kind === 'pull' ? repo.pulls.get(selected.number) : undefined;
  return <>
    <Filters repo={repo} filter={filter} setFilter={setFilter} extra={<button className="gh-dropdown" title="全部折叠 / 展开" onClick={() => setCollapsed(c => c.size ? new Set() : new Set(withKids.map(i => i.number)))}>{collapsed.size ? '全部展开' : '全部折叠'}</button>} />
    <div className="gh-scroll gh-tree">
      {!!withKids.length && <div className="gh-tree-group">有子 issue 的</div>}
      {withKids.map(i => row(i, 0))}
      {!!standalone.length && <button className="gh-tree-group gh-tree-group-btn" onClick={() => setLoose(l => !l)}>{loose ? '⌄' : '›'} 独立 issue · {standalone.length}</button>}
      {loose && standalone.map(i => row(i, 0))}
      {!!pulls.length && <div className="gh-tree-group">未关联 issue 的 PR · {pulls.length}</div>}
      {pulls.map(p => <div key={p.number} className={`gh-tree-row ${selPull?.number === p.number ? 'selected' : ''}`} style={{ '--depth': 0 } as React.CSSProperties} onClick={() => select({ kind: 'pull', number: p.number })}>
        <span className="gh-tree-guides" /><span className="gh-disclosure" /><PullGlyph pull={p} /><span className="gh-num">#{p.number}</span><span className="gh-ellipsis">{p.title}</span><span className="gh-tree-side"><Checks pull={p} /></span></div>)}
      {selPull && <div className="gh-tree-detail"><PullDetail repo={repo} pull={selPull} onOpen={setSelected} /></div>}
      {!withKids.length && !standalone.length && !pulls.length && <p className="gh-empty">没有符合条件的 issue</p>}
      <p className="gh-legend muted">🔒 被开放 issue 卡住 · n/m 子 issue 已关闭数 · 灰色行是为了显示上下文的祖先 · 标签：{filter.labels.map(l => <LabelChip key={l} repo={repo} name={l} />)}{!filter.labels.length && '无'}</p>
    </div>
  </>;
}
