// PROTOTYPE — throwaway, part of prototype-workbench.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import { statusName, type Pane } from './prototype-ephemeral-panels-data';
import type { ProcessingState } from '../shared/processing-status';

export function NavLink({ pane: p, selected, ephemeral = false, onClick }: { pane: Pane; selected: boolean; ephemeral?: boolean; onClick(): void }) {
  return <button className={`panel-link ${p.agent} ${selected ? 'selected' : ''} ${ephemeral ? `proto-nav-ephemeral status-${p.status}` : ''}`} title={`${statusName[p.status]} · ${p.title}`} onClick={onClick}>
    <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span>
    <span className="session-title">{p.title}</span>{ephemeral && p.status !== 'busy' && <small className="proto-nav-status">{statusName[p.status]}</small>}
  </button>;
}

/**
 * A fake terminal. Esc always belongs to the CLI (#160): on a busy pane it interrupts the turn, like Claude Code and Codex do.
 * `draft` is what a 只填入 dispatch pasted (no Enter); `focusKey` changing moves focus into the input.
 */
export function PanelView({ pane: p, focused, ephemeral = false, actions, onFocus, onReply, onInterrupt, onHeaderDragStart, onDragEnd, focusKey }: {
  pane: Pane; focused: boolean; ephemeral?: boolean; actions: ReactNode; onFocus?(): void; onReply(id: string, text: string): void; onInterrupt?(id: string): void;
  onHeaderDragStart?(event: React.DragEvent): void; onDragEnd?(): void; focusKey?: number;
}) {
  const scroller = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; } }, [p.id]);
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [p.lines.length]);
  useEffect(() => { if (p.draft !== undefined && input.current) input.current.value = (input.current.value ? input.current.value + ' ' : '') + p.draft; }, [p.draft, p.draftKey]);
  useEffect(() => { if (focusKey) input.current?.focus(); }, [focusKey]);
  return <div className={`agent-panel ${focused ? 'focused' : ''} ${ephemeral ? 'proto-ephemeral' : ''}`} onMouseDown={onFocus}>
    <header className="panel-header" draggable={!!onHeaderDragStart} onDragStart={onHeaderDragStart} onDragEnd={onDragEnd} style={onHeaderDragStart ? { cursor: 'grab' } : undefined}><span className="agent-title"><span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span>
      <span className="session-title">{p.title}</span>{ephemeral && <span className="proto-badge">临时</span>}</span>
      <span className="panel-actions">{actions}</span></header>
    <div className="proto-term">
      <pre ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>{p.lines.join('\n')}</pre>
      {p.question && <div className="proto-question">? {p.question}</div>}
      <form onSubmit={e => { e.preventDefault(); const v = input.current!.value.trim(); if (v) { onReply(p.id, v); input.current!.value = ''; } }}>
        <span>›</span><input ref={input} onFocus={onFocus} placeholder={p.status === 'needs-input' ? '回复后按 Enter' : p.status === 'busy' ? '处理中，按 Esc 中断' : '输入给 Agent…'}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onInterrupt?.(p.id); } }} />
      </form>
    </div>
  </div>;
}

// #126：汇总在工作区工具栏中间，列表向下弹出；Esc 先关列表。
export function ToolbarSummary({ panes, ephemeralIds, onLocate }: { panes: Pane[]; ephemeralIds: Set<string>; onLocate(id: string): void }) {
  const states = ['ready', 'needs-input', 'done', 'error'] as const;
  const [open, setOpen] = useState<typeof states[number]>();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(undefined); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(undefined); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  const members = (s: ProcessingState) => panes.filter(p => p.status === s);
  return <div className="proto-tsummary" ref={root}>
    {states.map(s => <button key={s} className="summary-entry" disabled={!members(s).length} aria-expanded={open === s} title={`${members(s).length} ${statusName[s]}`}
      onClick={() => setOpen(o => o === s ? undefined : s)}><ProcessingStatusIcon state={s} /><span>{members(s).length}<span className="summary-name"> {statusName[s]}</span></span></button>)}
    {open && <section className="summary-list proto-tsummary-list" role="dialog" aria-label={statusName[open]}>
      <header><strong>{statusName[open]}</strong><button onClick={() => setOpen(undefined)}>×</button></header>
      <ul>{members(open).map(p => <li key={p.id}><button className={`summary-panel ${p.agent}`} onClick={() => { setOpen(undefined); onLocate(p.id); }}>
        <span className="agent-mark">{agentIcons[p.agent]}</span><span className="session-title">{p.title}</span><small>{ephemeralIds.has(p.id) ? '临时 · 临时放大' : '常驻'}</small>
      </button></li>)}</ul>
      {!members(open).length && <p className="muted">没有面板</p>}
    </section>}
  </div>;
}
