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
  const [expanded, setExpanded] = useState<Set<number>>(new Set()); // #160: parents start collapsed
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
  // #160: the tree stays, but children start collapsed behind a summary chip on the parent's own meta line;
  // expanded children keep their full rows and sit in a block with one line down its left edge.
  const row = (i: Issue, parent?: number): ReactNode => {
    const { shown, folded } = kidsOf(i);
    const hasKids = shown.length > 0 || folded.length > 0;
    const open = expanded.has(i.number);
    order.push({ n: i.number, parent, kids: hasKids ? shown.map(k => k.number) : [] });
    const blockers = openBlockers(repo, i);
    const records = dispatches.filter(d => d.issue === i.number);
    const all = [...shown, ...folded.filter(f => !shown.includes(f))];
    const openKids = all.filter(k => k.state === 'open').length;
    const dispatched = all.filter(k => dispatches.some(d => d.issue === k.number)).length;
    return <React.Fragment key={i.number}>
      <div data-row={i.number} className={`gh-row ${cursor === i.number ? 'selected' : ''} ${issueMatches(i, filter) ? '' : 'context'}`}
        onClick={() => { onCursor(i.number); onOpenDetail(i.number); }}>
        <IssueIcon issue={i} />
        <div className="gh-row-main">
          <div className="gh-row-title">{i.title}</div>
          <div className="gh-row-meta">
            <span className="gh-row-num">#{i.number}</span><span>{ago(i.createdAt)}</span>
            {hasKids && <button className={`wb-kids ${open ? 'open' : ''}`} tabIndex={-1} title={open ? '收起子 issue' : '展开子 issue'}
              onClick={e => { e.stopPropagation(); setExpanded(x => flipSet(x, i.number)); }}>
              <span className="wb-kids-caret">{open ? '▾' : '▸'}</span><span>子 issue</span><Progress {...childProgress(repo, i.number)} />
              {!!openKids && <span>· {openKids} 未完成</span>}{!!dispatched && <span>· {dispatched} 已派发</span>}</button>}
            {!!blockers.length && <Blocked repo={repo} by={blockers} />}
            {i.labels.map(l => <Label key={l} repo={repo} name={l} onClick={() => addLabel(l)} />)}
          </div>
        </div>
        {i.state === 'open' && <div className="gh-row-action">
          {!!records.length && <DispatchStatus records={records} panes={panes} onLocate={onLocate} />}
          {dispatchButton(i, !!blockers.length)}
        </div>}
      </div>
      {hasKids && open && <div className="wb-kids-body">
        {shown.map(k => row(k, i.number))}
        {!!folded.length && <button className="gh-fold" tabIndex={-1} onClick={() => setShownClosed(s => flipSet(s, i.number))}>
          {shownClosed.has(i.number) ? '收起已关闭' : `已关闭 ${folded.length} 个`}</button>}
      </div>}
    </React.Fragment>;
  };
  const rows = roots.map(i => row(i));

  useEffect(() => { listRef.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor, listRef]);
  const keydown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return;
    const at = order.findIndex(o => o.n === cursor);
    const here = order[at];
    const go = (n?: number) => { if (n !== undefined) onCursor(n); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(order[Math.min(order.length - 1, at + 1)]?.n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(order[Math.max(0, at - 1)]?.n); }
    else if (e.key === 'ArrowLeft' && here) { e.preventDefault(); if (here.kids.length) { if (!expanded.has(here.n)) setExpanded(c => flipSet(c, here.n)); else go(here.kids[0]); } }
    else if (e.key === 'ArrowRight' && here) { e.preventDefault(); if (here.kids.length && expanded.has(here.n)) setExpanded(c => flipSet(c, here.n)); else go(here.parent); }
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
