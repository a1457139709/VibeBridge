// PROTOTYPE — throwaway, part of prototype-github-sidebar.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
// Variant「全图」: every issue (and optionally PR) is a dot; parent/child, blocked-by and PR-closes relations are drawn as lines.
// Unrelated issues stay as free dots. Hand-rolled force layout (no deps); can expand into the layout area.
import React, { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { issueMatchesText, pullIsOpen, pullMatchesText, type Filter, type Repo, type Selected } from './prototype-github-sidebar-model';

export interface GraphOptions { layout: 'force' | 'time'; closed: 'fade' | 'hide' | 'show'; pulls: boolean; unmatched: 'fade' | 'hide' }
export const defaultGraphOptions: GraphOptions = { layout: 'force', closed: 'fade', pulls: true, unmatched: 'fade' };

type Kind = 'issue' | 'pull';
interface GNode { id: string; kind: Kind; n: number; title: string; tone: string; closed: boolean; match: boolean; map: boolean; created: number; deg: number }
interface GEdge { a: string; b: string; kind: 'parent' | 'blocks' | 'closes' }
const id = (kind: Kind, n: number) => `${kind === 'issue' ? 'i' : 'p'}${n}`;

function buildGraph(repo: Repo, filter: Filter, o: GraphOptions) {
  const nodes: GNode[] = [];
  for (const i of repo.snapshot.issues) {
    if (o.closed === 'hide' && i.state === 'closed') continue;
    nodes.push({ id: id('issue', i.number), kind: 'issue', n: i.number, title: i.title, closed: i.state === 'closed', match: issueMatchesText(i, filter), map: i.labels.includes('wayfinder:map'),
      tone: i.state === 'open' ? 'open' : i.reason === 'not_planned' ? 'skipped' : 'done', created: Date.parse(i.createdAt), deg: 0 });
  }
  if (o.pulls) for (const p of repo.snapshot.pulls) {
    if (o.closed === 'hide' && !pullIsOpen(p)) continue;
    nodes.push({ id: id('pull', p.number), kind: 'pull', n: p.number, title: p.title, closed: !pullIsOpen(p), match: pullMatchesText(repo, p, filter), map: false,
      tone: { open: 'open', draft: 'skipped', merged: 'done', closed: 'failed' }[p.state], created: Date.parse(p.createdAt), deg: 0 });
  }
  let kept = o.unmatched === 'hide' ? nodes.filter(n => n.match) : nodes;
  const has = new Set(kept.map(n => n.id));
  const edges: GEdge[] = [];
  const add = (a: string, b: string, kind: GEdge['kind']) => { if (has.has(a) && has.has(b) && !edges.some(e => e.a === a && e.b === b)) edges.push({ a, b, kind }); };
  for (const i of repo.snapshot.issues) {
    if (i.parent) add(id('issue', i.parent), id('issue', i.number), 'parent');
    for (const b of i.blockedBy) add(id('issue', b), id('issue', i.number), 'blocks');
    for (const p of repo.prsOf.get(i.number) ?? []) add(id('pull', p), id('issue', i.number), 'closes');
  }
  const byId = new Map(kept.map(n => [n.id, n]));
  for (const e of edges) { byId.get(e.a)!.deg++; byId.get(e.b)!.deg++; }
  kept = kept.map(n => ({ ...n }));
  return { nodes: kept, edges };
}

/** Deterministic force simulation. In time mode x is pinned to creation time and only y relaxes. */
function simulate(nodes: GNode[], edges: GEdge[], mode: GraphOptions['layout']) {
  const N = nodes.length;
  const at = new Map(nodes.map((n, k) => [n.id, k]));
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
  const t0 = Math.min(...nodes.map(n => n.created)), t1 = Math.max(...nodes.map(n => n.created));
  const span = Math.max(500, N * 7);
  const tx = (t: number) => t1 === t0 ? 0 : (t - t0) / (t1 - t0) * span - span / 2;
  nodes.forEach((n, k) => { const a = k * 2.39996, r = 12 * Math.sqrt(k + 1); x[k] = mode === 'time' ? tx(n.created) : Math.cos(a) * r; y[k] = Math.sin(a) * r; });
  const links = edges.map(e => ({ a: at.get(e.a)!, b: at.get(e.b)!, L: e.kind === 'closes' ? 22 : e.kind === 'parent' ? 34 : 46 }));
  const steps = 360;
  for (let it = 0; it < steps; it++) {
    const alpha = 1 - it / steps;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = x[i] - x[j], dy = y[i] - y[j];
      const d2 = Math.max(dx * dx + dy * dy, 4);
      if (d2 > 160 * 160) continue;
      const f = 700 / d2, d = Math.sqrt(d2);
      vx[i] += dx / d * f; vy[i] += dy / d * f; vx[j] -= dx / d * f; vy[j] -= dy / d * f;
    }
    for (const l of links) {
      const dx = x[l.b] - x[l.a], dy = y[l.b] - y[l.a], d = Math.max(Math.hypot(dx, dy), 0.01);
      const k = (d - l.L) / d * 0.12;
      vx[l.a] += dx * k; vy[l.a] += dy * k; vx[l.b] -= dx * k; vy[l.b] -= dy * k;
    }
    for (let i = 0; i < N; i++) {
      vx[i] -= x[i] * 0.012; vy[i] -= y[i] * (mode === 'time' ? 0.004 : 0.012);
      if (mode !== 'time') x[i] += vx[i] * alpha;
      y[i] += vy[i] * alpha; vx[i] *= 0.45; vy[i] *= 0.45;
    }
  }
  return { pos: new Map(nodes.map((n, k) => [n.id, { x: x[k], y: y[k] }])), tx, t0, t1 };
}

export function GraphView({ repo, filter, options, selected, setSelected, big = false }: { repo: Repo; filter: Filter; options: GraphOptions; selected: Selected; setSelected(s: Selected): void; big?: boolean }) {
  const { nodes, edges } = useMemo(() => buildGraph(repo, filter, options), [repo, filter, options]);
  const shape = nodes.map(n => n.id).join(',') + options.layout;
  // Re-layout only when the node set changes, not when matching (dimming) changes.
  const layout = useMemo(() => simulate(nodes, edges, options.layout), [shape, edges.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const bounds = useMemo(() => {
    const ps = [...layout.pos.values()];
    const minX = Math.min(...ps.map(p => p.x)) - 30, maxX = Math.max(...ps.map(p => p.x)) + 30, minY = Math.min(...ps.map(p => p.y)) - 30, maxY = Math.max(...ps.map(p => p.y)) + (options.layout === 'time' ? 50 : 30);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }, [layout, options.layout]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const [vb, setVb] = useState(bounds);
  const [hover, setHover] = useState<string>();
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(host.current!); return () => ro.disconnect();
  }, []);
  // Fit: keep the aspect of the host so the graph is not stretched.
  const fit = () => {
    const aspect = size.w / Math.max(size.h, 1);
    const w = Math.max(bounds.w, bounds.h * aspect), h = w / aspect;
    setVb({ x: bounds.x + bounds.w / 2 - w / 2, y: bounds.y + bounds.h / 2 - h / 2, w, h });
  };
  useEffect(fit, [bounds, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const svg = useRef<SVGSVGElement>(null);
  const toSvg = (cx: number, cy: number) => { const r = svg.current!.getBoundingClientRect(); return { x: vb.x + (cx - r.left) / r.width * vb.w, y: vb.y + (cy - r.top) / r.height * vb.h }; };
  useEffect(() => {
    const el = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY), k = Math.exp(e.deltaY * 0.0015);
      setVb(v => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
    };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  });
  const pan = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest('.gh-gnode')) return;
    const start = { cx: e.clientX, cy: e.clientY, v: vb }, r = svg.current!.getBoundingClientRect();
    const move = (m: PointerEvent) => setVb({ ...start.v, x: start.v.x - (m.clientX - start.cx) / r.width * start.v.w, y: start.v.y - (m.clientY - start.cy) / r.height * start.v.h });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const selId = selected && id(selected.kind, selected.number);
  const focus = hover ?? selId;
  const near = new Set<string>(focus ? [focus, ...edges.filter(e => e.a === focus || e.b === focus).flatMap(e => [e.a, e.b])] : []);
  const unitsPerPx = vb.w / Math.max(size.w, 1);
  const showNums = unitsPerPx < 0.75;
  const isolated = nodes.filter(n => !n.deg).length;
  const hovered = nodes.find(n => n.id === (hover ?? selId));
  const r = (n: GNode) => (n.map ? 9 : 3.6 + Math.sqrt(n.deg) * 1.5) * Math.min(1, Math.max(0.55, unitsPerPx * 1.1)) ** 0.35;
  const dimmed = (n: GNode) => (focus && !near.has(n.id)) || (!n.match && options.unmatched === 'fade') || (n.closed && options.closed === 'fade');
  // Time axis ticks: weekly when the repo spans under ~4 months, monthly otherwise.
  const weekly = layout.t1 - layout.t0 < 120 * 86400e3;
  const months = options.layout === 'time' && layout.t1 > layout.t0 ? Array.from({ length: 40 }, (_, k) => {
    const d = new Date(layout.t0); d.setHours(0, 0, 0, 0);
    if (weekly) d.setDate(d.getDate() + (k + 1) * 7); else { d.setDate(1); d.setMonth(d.getMonth() + k + 1); }
    return d;
  }).filter(d => d.getTime() <= layout.t1) : [];

  return <div className={`gh-graph ${big ? 'big' : ''}`} ref={host}>
    <div className="gh-graph-caption">{hovered ? <><b>{hovered.kind === 'pull' ? 'PR ' : ''}#{hovered.n}</b> {hovered.title}</> : <span className="muted">{nodes.length} 个点 · {edges.length} 条线 · {isolated} 个孤立点　滚轮缩放 · 拖动平移 · 点击查看</span>}</div>
    <svg ref={svg} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} onPointerDown={pan} onDoubleClick={fit} onClick={e => { if (!(e.target as Element).closest('.gh-gnode')) setSelected(undefined); }}>
      <defs><marker id="gh-arrow" viewBox="0 0 8 8" refX="12" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8z" className="gh-arrow" /></marker></defs>
      {months.map(d => { const x = layout.tx(d.getTime()); return <g key={d.getTime()} className="gh-axis"><line x1={x} x2={x} y1={bounds.y} y2={bounds.y + bounds.h - 20} /><text x={x} y={bounds.y + bounds.h - 6}>{d.getMonth() + 1}/{d.getDate()}</text></g>; })}
      {edges.map(e => { const a = layout.pos.get(e.a)!, b = layout.pos.get(e.b)!; const lit = focus ? near.has(e.a) && near.has(e.b) && (e.a === focus || e.b === focus) : true;
        return <line key={`${e.a}-${e.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`gh-edge gh-edge-${e.kind} ${lit ? '' : 'dim'}`} markerEnd={e.kind === 'blocks' ? 'url(#gh-arrow)' : undefined} />; })}
      {nodes.map(n => { const p = layout.pos.get(n.id)!, rr = r(n); const label = showNums || near.has(n.id) || n.map;
        return <g key={n.id} className={`gh-gnode gh-${n.tone} ${dimmed(n) ? 'dim' : ''} ${n.id === selId ? 'sel' : ''} ${n.map ? 'map' : ''}`} transform={`translate(${p.x} ${p.y})`}
          onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(undefined)} onClick={() => setSelected({ kind: n.kind, number: n.n })}>
          {n.kind === 'pull' ? <rect x={-rr} y={-rr} width={rr * 2} height={rr * 2} rx={rr * 0.3} /> : <circle r={rr} />}
          {n.map && <circle r={rr + 3} className="gh-map-ring" />}
          {label && <text y={-rr - 2.5} style={{ fontSize: Math.max(5, Math.min(11, unitsPerPx * 10)) }}>#{n.n}</text>}
        </g>; })}
    </svg>
    <div className="gh-graph-legend"><span><i className="gh-open" />开放</span><span><i className="gh-done" />完成/合并</span><span><i className="gh-skipped" />不做/草稿</span><span><i className="gh-sq" />PR</span>
      <span><b className="gh-l-parent" />父子</span><span><b className="gh-l-blocks" />卡住 →</span><span><b className="gh-l-closes" />PR 关闭</span></div>
    <button className="gh-graph-fit" title="适应视图（双击空白处也可以）" onClick={fit}>⟲</button>
  </div>;
}

export function GraphOptionsBar({ options, setOptions, big, onToggleBig }: { options: GraphOptions; setOptions(update: (o: GraphOptions) => GraphOptions): void; big: boolean; onToggleBig(): void }) {
  const seg = <K extends keyof GraphOptions>(key: K, items: [GraphOptions[K], string][]) => <span className="gh-seg">{items.map(([v, name]) =>
    <button key={String(v)} className={options[key] === v ? 'on' : ''} onClick={() => setOptions(o => ({ ...o, [key]: v }))}>{name}</button>)}</span>;
  return <div className="gh-graph-options">
    {seg('layout', [['force', '关系'], ['time', '时间轴']])}
    <span className="gh-opt-label">已关闭</span>{seg('closed', [['fade', '淡化'], ['hide', '隐藏'], ['show', '正常']])}
    <span className="gh-opt-label">不匹配</span>{seg('unmatched', [['fade', '淡化'], ['hide', '隐藏']])}
    <label className="gh-check"><input type="checkbox" checked={options.pulls} onChange={e => setOptions(o => ({ ...o, pulls: e.target.checked }))} />PR</label>
    <button className="gh-dropdown" onClick={onToggleBig} title="在布局区域临时放大查看（Esc 返回）">{big ? '⤡ 收回侧边栏' : '⤢ 放大到布局区域'}</button>
  </div>;
}
