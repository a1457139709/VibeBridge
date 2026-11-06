// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// v2 lists. Issues: tree skeleton (children under their parent, closed children folded), each row = information + action.
// Pull requests: flat, newest first, checks and review as coloured text.
import React, { useMemo, useState } from 'react';
import { childProgress, issueMatches, newestFirst, openBlockers, pullMatches, sameSelection, type DispatchRecord, type Filter, type Issue, type Pane, type Repo, type Selected } from './prototype-github-sidebar-model';
import { Blocked, checksText, DispatchSplit, DispatchStatus, IssueIcon, Label, Progress, PullIcon, reviewText } from './prototype-github-sidebar-common';
import { ago } from './prototype-github-sidebar-model';

interface IssueListProps {
  repo: Repo; filter: Filter; setFilter(update: (f: Filter) => Filter): void; selected: Selected; onSelect(s: Selected): void;
  panes: Pane[]; dispatches: DispatchRecord[]; onDispatch(issue: number, step: string, pane: string | 'new'): void; onLocate(pane: string): void;
}

export function IssueList({ repo, filter, setFilter, selected, onSelect, panes, dispatches, onDispatch, onLocate }: IssueListProps) {
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
  const flip = (set: Set<number>, n: number) => { const next = new Set(set); if (next.has(n)) next.delete(n); else next.add(n); return next; };
  const roots = newestFirst(repo.snapshot.issues.filter(i => (!i.parent || !repo.issues.has(i.parent)) && visible.get(i.number)));
  const addLabel = (l: string) => setFilter(f => f.labels.includes(l) ? f : { ...f, labels: [...f.labels, l] });

  const row = (i: Issue, depth: number): React.ReactNode => {
    const kids = (repo.children.get(i.number) ?? []).map(n => repo.issues.get(n)).filter((k): k is Issue => !!k);
    const shown = kids.filter(k => visible.get(k.number));
    const folded = filter.state === 'open' ? kids.filter(k => k.state === 'closed' && issueMatches(k, { ...filter, state: 'closed' })) : [];
    const open = !collapsed.has(i.number);
    const blockers = openBlockers(repo, i);
    const records = dispatches.filter(d => d.issue === i.number);
    const progress = childProgress(repo, i.number);
    return <React.Fragment key={i.number}>
      <div className={`gh-row ${sameSelection(selected, { kind: 'issue', number: i.number }) ? 'selected' : ''} ${issueMatches(i, filter) ? '' : 'context'}`}
        style={{ '--depth': depth } as React.CSSProperties} onClick={() => onSelect({ kind: 'issue', number: i.number })}>
        {kids.length ? <button className="gh-disclosure" title={open ? '折叠' : '展开'} onClick={e => { e.stopPropagation(); setCollapsed(c => flip(c, i.number)); }}>{open ? '▾' : '▸'}</button> : <span className="gh-disclosure" />}
        <IssueIcon issue={i} />
        <div className="gh-row-main">
          <div className="gh-row-title">{i.title}</div>
          <div className="gh-row-meta">
            <span className="gh-row-num">#{i.number}</span><span>{ago(i.createdAt)}</span>
            {!!blockers.length && <Blocked repo={repo} by={blockers} />}
            <Progress {...progress} />
            {i.labels.map(l => <Label key={l} repo={repo} name={l} onClick={() => addLabel(l)} />)}
          </div>
        </div>
        <div className="gh-row-action">
          {records.length ? <DispatchStatus records={records} panes={panes} onLocate={onLocate} />
            : i.state === 'open' && <DispatchSplit issue={i} panes={panes} weak={!!blockers.length} onDispatch={(step, pane) => onDispatch(i.number, step, pane)} />}
        </div>
      </div>
      {open && shown.map(k => row(k, depth + 1))}
      {open && !!folded.length && (shownClosed.has(i.number) ? folded.map(k => row(k, depth + 1)) : null)}
      {open && !!folded.length && <button className="gh-fold" style={{ '--depth': depth + 1 } as React.CSSProperties} onClick={() => setShownClosed(s => flip(s, i.number))}>
        {shownClosed.has(i.number) ? '收起已关闭' : `已关闭 ${folded.length} 个`}</button>}
    </React.Fragment>;
  };

  return <div className="gh-scroll">
    {roots.map(i => row(i, 0))}
    {!roots.length && <p className="gh-empty">没有符合条件的 issue</p>}
  </div>;
}

export function PullList({ repo, filter, selected, onSelect }: { repo: Repo; filter: Filter; selected: Selected; onSelect(s: Selected): void }) {
  const pulls = newestFirst(repo.snapshot.pulls.filter(p => pullMatches(p, filter)));
  return <div className="gh-scroll">
    {pulls.map(p => {
      const checks = checksText(p.checks);
      const review = reviewText(p.review);
      return <div key={p.number} className={`gh-row ${sameSelection(selected, { kind: 'pull', number: p.number }) ? 'selected' : ''}`} style={{ '--depth': 0 } as React.CSSProperties}
        onClick={() => onSelect({ kind: 'pull', number: p.number })}>
        <span className="gh-disclosure" /><PullIcon pull={p} />
        <div className="gh-row-main">
          <div className="gh-row-title">{p.title}</div>
          <div className="gh-row-meta"><span className="gh-row-num">#{p.number}</span><span>{ago(p.createdAt)}</span><span className="gh-branch">{p.branch}</span>
            {p.state === 'draft' && <span>草稿</span>}{p.state === 'merged' && <span className="gh-done">已合并</span>}</div>
        </div>
        <div className="gh-row-action gh-pr-status">
          <span className={`gh-${checks.tone}`}>{checks.text}</span>
          {review && <span className={`gh-${review.tone}`}>{review.text}</span>}
        </div>
      </div>;
    })}
    {!pulls.length && <p className="gh-empty">没有符合条件的 PR</p>}
  </div>;
}
