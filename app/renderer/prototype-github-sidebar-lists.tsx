// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Lists. Issues: tree skeleton (children under their parent, closed children folded), each row = information + action.
// Pull requests: flat, newest first, checks as coloured text, no action (PRs are not dispatched).
// Keys (#157): ↑/↓ move without wrapping; ← expands (already expanded: into the first child); → collapses (already collapsed: to the parent);
// Space or Enter opens the detail; Esc does nothing.
import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ago, childProgress, issueMatches, newestFirst, openBlockers, pullMatches, type DispatchRecord, type Filter, type Issue, type Pane, type Repo } from './prototype-github-sidebar-model';
import { Blocked, checksText, DispatchStatus, IssueIcon, Label, Progress, PullIcon } from './prototype-github-sidebar-common';

interface IssueListProps {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; cursor?: number; onCursor(n: number): void; onOpenDetail(n: number): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onLocate(pane: string): void; dispatchButton(issue: Issue, weak: boolean): ReactNode; listRef: React.RefObject<HTMLDivElement | null>;
}

const flipSet = (set: Set<number>, n: number) => { const next = new Set(set); if (next.has(n)) next.delete(n); else next.add(n); return next; };

export function IssueList({ repo, filter, setFilter, cursor, onCursor, onOpenDetail, panes, dispatches, onLocate, dispatchButton, listRef }: IssueListProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [shownClosed, setShownClosed] = useState<Set<number>>(new Set());
  // Visible when it matches or a descendant matches; non-matching ancestors stay as context.
  const visible = useMemo(() => {
    const memo = new Map<number, boolean>();
    const walk = (n: number): boolean => {
      if (memo.has(n)) return memo.get(n)!;
      memo.set(n, false);
      const v = issueMatches(repo.issues.get(n)!, filter) || (repo.children.get(n) ?? []).some(walk);
      memo.set(n, v); return v;
    };
    for (const i of repo.snapshot.issues) walk(i.number);
    return memo;
  }, [repo, filter]);
  const roots = newestFirst(repo.snapshot.issues.filter(i => (!i.parent || !repo.issues.has(i.parent)) && visible.get(i.number)));
  const addLabel = (l: string) => setFilter(f => f.labels.includes(l) ? f : { ...f, labels: [...f.labels, l] });

  // The rows in screen order, with what the arrow keys need to know about each.
  const order: { n: number; parent?: number; kids: number[] }[] = [];
  const kidsOf = (i: Issue) => {
    const kids = (repo.children.get(i.number) ?? []).map(n => repo.issues.get(n)).filter((k): k is Issue => !!k);
    const folded = filter.state === 'open' ? kids.filter(k => k.state === 'closed' && issueMatches(k, { ...filter, state: 'closed' })) : [];
    const shown = kids.filter(k => visible.get(k.number));
    return { kids, shown: shownClosed.has(i.number) ? [...shown, ...folded.filter(f => !shown.includes(f))] : shown, folded };
  };
  const row = (i: Issue, depth: number, parent?: number, last = false, rails: number[] = []): ReactNode => {
    const { kids, shown, folded } = kidsOf(i);
    const open = !collapsed.has(i.number);
    order.push({ n: i.number, parent, kids: shown.map(k => k.number) });
    const blockers = openBlockers(repo, i);
    const records = dispatches.filter(d => d.issue === i.number);
    return <React.Fragment key={i.number}>
      <div data-row={i.number} data-last={last || undefined} className={`gh-row ${cursor === i.number ? 'selected' : ''} ${issueMatches(i, filter) ? '' : 'context'}`}
        style={{ '--depth': depth } as React.CSSProperties} onClick={() => { onCursor(i.number); onOpenDetail(i.number); }}>
        {rails.map(l => <span key={l} className="wb-rail" style={{ '--l': l } as React.CSSProperties} />)}
        {kids.length ? <button className="gh-disclosure" tabIndex={-1} title={open ? '折叠' : '展开'} onClick={e => { e.stopPropagation(); setCollapsed(c => flipSet(c, i.number)); }}>{open ? '▾' : '▸'}</button> : <span className="gh-disclosure" />}
        <IssueIcon issue={i} />
        <div className="gh-row-main">
          <div className="gh-row-title">{i.title}</div>
          <div className="gh-row-meta">
            <span className="gh-row-num">#{i.number}</span><span>{ago(i.createdAt)}</span>
            {!!blockers.length && <Blocked repo={repo} by={blockers} />}
            <Progress {...childProgress(repo, i.number)} />
            {i.labels.map(l => <Label key={l} repo={repo} name={l} onClick={() => addLabel(l)} />)}
          </div>
        </div>
        {i.state === 'open' && <div className="gh-row-action">
          {!!records.length && <DispatchStatus records={records} panes={panes} onLocate={onLocate} />}
          {dispatchButton(i, !!blockers.length)}
        </div>}
      </div>
      {open && shown.map((k, n) => row(k, depth + 1, i.number, n === shown.length - 1 && !folded.length, depth > 0 && !last ? [...rails, depth] : rails))}
      {open && !!folded.length && <button className="gh-fold" tabIndex={-1} style={{ '--depth': depth + 1 } as React.CSSProperties} onClick={() => setShownClosed(s => flipSet(s, i.number))}>
        {shownClosed.has(i.number) ? '收起已关闭' : `已关闭 ${folded.length} 个`}</button>}
    </React.Fragment>;
  };
  const rows = roots.map(i => row(i, 0));

  useEffect(() => { listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor, listRef]);
  const keydown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return;
    const at = order.findIndex(o => o.n === cursor);
    const here = order[at];
    const go = (n?: number) => { if (n !== undefined) onCursor(n); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(order[Math.min(order.length - 1, at + 1)]?.n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(order[Math.max(0, at - 1)]?.n); }
    else if (e.key === 'ArrowLeft' && here) { e.preventDefault(); if (here.kids.length) { if (collapsed.has(here.n)) setCollapsed(c => flipSet(c, here.n)); else go(here.kids[0]); } }
    else if (e.key === 'ArrowRight' && here) { e.preventDefault(); if (here.kids.length && !collapsed.has(here.n)) setCollapsed(c => flipSet(c, here.n)); else go(here.parent); }
    else if ((e.key === ' ' || e.key === 'Enter') && here) { e.preventDefault(); onOpenDetail(here.n); }
  };

  return <div className="gh-scroll" ref={listRef} tabIndex={0} onKeyDown={keydown} onFocus={() => { if (cursor === undefined && order[0]) onCursor(order[0].n); }}>
    {rows}
    {!roots.length && <p className="gh-empty">没有符合条件的 issue</p>}
  </div>;
}

// Two lines like issues. Line 1 state icon + title; line 2 number, created, author, checks, labels. Review lives only in the merge box.
export function PullList({ repo, filter, setFilter, cursor, onCursor, onOpenDetail, listRef }: {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; cursor?: number; onCursor(n: number): void; onOpenDetail(n: number): void; listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pulls = newestFirst(repo.snapshot.pulls.filter(p => pullMatches(p, filter)));
  const addLabel = (l: string) => setFilter(f => f.labels.includes(l) ? f : { ...f, labels: [...f.labels, l] });
  useEffect(() => { listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor, listRef]);
  const keydown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return;
    const at = pulls.findIndex(p => p.number === cursor);
    if (e.key === 'ArrowDown') { e.preventDefault(); const p = pulls[Math.min(pulls.length - 1, at + 1)]; if (p) onCursor(p.number); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const p = pulls[Math.max(0, at - 1)]; if (p) onCursor(p.number); }
    else if ((e.key === ' ' || e.key === 'Enter') && cursor !== undefined) { e.preventDefault(); onOpenDetail(cursor); }
  };
  return <div className="gh-scroll" ref={listRef} tabIndex={0} onKeyDown={keydown} onFocus={() => { if (cursor === undefined && pulls[0]) onCursor(pulls[0].number); }}>
    {pulls.map(p => {
      const open = p.state === 'open' || p.state === 'draft';
      const checks = checksText(p.checks);
      return <div key={p.number} data-row={p.number} className={`gh-row ${cursor === p.number ? 'selected' : ''}`} style={{ '--depth': 0 } as React.CSSProperties}
        onClick={() => { onCursor(p.number); onOpenDetail(p.number); }}>
        <span className="gh-disclosure" /><PullIcon pull={p} />
        <div className="gh-row-main">
          <div className="gh-row-title">{p.title}</div>
          <div className="gh-row-meta">
            <span className="gh-row-num">#{p.number}</span><span>{ago(p.createdAt)}</span><span className="gh-author">{p.author}</span>
            {open && p.checks !== 'none' && <span className={`gh-pr-chip gh-${checks.tone}`}>{checks.mark} {checks.text}</span>}
            {(p.labels ?? []).map(l => <Label key={l} repo={repo} name={l} onClick={() => addLabel(l)} />)}
          </div>
        </div>
      </div>;
    })}
    {!pulls.length && <p className="gh-empty">没有符合条件的 PR</p>}
  </div>;
}
