// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// The small relation graph at the top of the detail pane, always three columns: open blockers on the left, the issue itself
// in the middle, what it still blocks and its PRs on the right. Sub-issue order lives in the detail's sub-issue list instead.
import React, { useEffect, useRef, useState } from 'react';
import { type Issue, type Repo, type Selected } from './prototype-github-sidebar-model';
import { IssueIcon, PullIcon } from './prototype-github-sidebar-common';

interface GNode { kind: 'issue' | 'pull'; n: number; col: number; row: number; self?: boolean }
interface GEdge { from: string; to: string; kind: 'blocks' | 'pr' }
const key = (kind: 'issue' | 'pull', n: number) => `${kind}${n}`;

// Only live blocks are drawn: a closed blocker is gone from the left, and a closed issue (or a closed dependent) drops from the right.
function build(repo: Repo, issue: Issue): { nodes: GNode[]; edges: GEdge[]; cols: number; heads: string[] } | undefined {
  const isOpen = (n: number) => repo.issues.get(n)?.state === 'open';
  const left = issue.blockedBy.filter(isOpen);
  const blocks = issue.state === 'open' ? (repo.blocks.get(issue.number) ?? []).filter(isOpen) : [];
  const right = [...blocks.map(n => ({ kind: 'issue' as const, n })), ...(repo.prsOf.get(issue.number) ?? []).map(n => ({ kind: 'pull' as const, n }))];
  if (!left.length && !right.length) return undefined;
  const nodes: GNode[] = [
    ...left.map((n, row) => ({ kind: 'issue' as const, n, col: 0, row })),
    { kind: 'issue', n: issue.number, col: 1, row: 0, self: true },
    ...right.map((r, row) => ({ ...r, col: 2, row })),
  ];
  const edges: GEdge[] = [
    ...left.map(n => ({ from: key('issue', n), to: key('issue', issue.number), kind: 'blocks' as const })),
    ...right.map(r => ({ from: key('issue', issue.number), to: key(r.kind, r.n), kind: r.kind === 'pull' ? 'pr' as const : 'blocks' as const })),
  ];
  return { nodes, edges, cols: 3, heads: ['被阻塞于', '本 issue', '阻塞了 · 关联 PR'] };
}

export function RelationGraph({ repo, issue, onOpen }: { repo: Repo; issue: Issue; onOpen(s: Selected): void }) {
  const host = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(host.current!); return () => ro.disconnect(); }, []);
  const g = build(repo, issue);
  if (!g) return <div ref={host} />; // nothing in any column: no graph
  const ROW = 28, HEAD = 20, PAD = 8, GAP = 28;
  const colW = (w - PAD * 2 - GAP * (g.cols - 1)) / g.cols;
  const rows = Math.max(...g.nodes.map(n => n.row)) + 1;
  // Center short columns vertically against the tallest one.
  const colRows = Array.from({ length: g.cols }, (_, c) => g.nodes.filter(n => n.col === c).length);
  const pos = new Map(g.nodes.map(n => [key(n.kind, n.n), { x: PAD + n.col * (colW + GAP), y: HEAD + (n.row + (rows - colRows[n.col]) / 2) * ROW }]));
  const H = HEAD + rows * ROW + 4;
  return <div className="gh-graph" ref={host} style={{ height: H }}>
    {g.heads.map((h, c) => <span key={c} className="gh-graph-head" style={{ left: PAD + c * (colW + GAP), width: colW }}>{h}</span>)}
    <svg width={w} height={H}>
      <defs>{(['blocks', 'pr'] as const).map(k => <marker key={k} id={`gh-arrow-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" className={`gh-arrow-${k}`} /></marker>)}</defs>
      {g.edges.map(e => {
        const a = pos.get(e.from), b = pos.get(e.to);
        if (!a || !b) return null;
        const x1 = a.x + colW, y1 = a.y + ROW / 2 - 2, x2 = b.x, y2 = b.y + ROW / 2 - 2, mx = (x1 + x2) / 2;
        return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 1} ${y2}`} className={`gh-edge gh-edge-${e.kind}`} markerEnd={`url(#gh-arrow-${e.kind})`} />;
      })}
    </svg>
    {g.nodes.map(n => {
      const p = pos.get(key(n.kind, n.n))!;
      const item = n.kind === 'issue' ? repo.issues.get(n.n) : repo.pulls.get(n.n);
      const closed = n.kind === 'issue' ? (item as Issue | undefined)?.state === 'closed' : false;
      return <button key={key(n.kind, n.n)} className={`gh-node ${n.self ? 'self' : ''} ${closed ? 'closed' : ''}`} style={{ left: p.x, top: p.y, width: colW }} title={item ? `#${n.n} ${item.title}` : `#${n.n}`}
        onClick={() => !n.self && onOpen({ kind: n.kind, number: n.n })}>
        {item && (n.kind === 'issue' ? <IssueIcon issue={item as Issue} size={12} /> : <PullIcon pull={repo.pulls.get(n.n)!} size={12} />)}
        <span className="gh-row-num">#{n.n}</span><span className="gh-ellipsis">{item?.title ?? '不在快照里'}</span>
      </button>;
    })}
  </div>;
}
