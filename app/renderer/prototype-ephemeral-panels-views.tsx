// PROTOTYPE — throwaway, part of prototype-ephemeral-panels.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
import React, { useEffect, useRef, type ReactNode } from 'react';
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

export function PanelView({ pane: p, focused, ephemeral = false, note, actions, onFocus, onReply, onHeaderDragStart, onDragEnd }: { pane: Pane; focused: boolean; ephemeral?: boolean; note?: string; actions: ReactNode; onFocus?(): void; onReply(id: string, text: string): void; onHeaderDragStart?(event: React.DragEvent): void; onDragEnd?(): void }) {
  const scroller = useRef<HTMLPreElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stick = useRef(true);
  useEffect(() => { const el = scroller.current; if (el) { el.scrollTop = el.scrollHeight; stick.current = true; } if (ephemeral) input.current?.focus(); }, [p.id]);
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [p.lines.length]);
  return <div className={`agent-panel ${focused ? 'focused' : ''} ${ephemeral ? 'proto-ephemeral' : ''}`} onMouseDown={onFocus}>
    <header className="panel-header" draggable={!!onHeaderDragStart} onDragStart={onHeaderDragStart} onDragEnd={onDragEnd} style={onHeaderDragStart ? { cursor: 'grab' } : undefined}><span className="agent-title"><span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span>
      <span className="session-title">{p.title}</span>{ephemeral && <span className="proto-badge">临时</span>}{note && <small className="proto-note">{note}</small>}</span>
      <span className="panel-actions">{actions}</span></header>
    <div className="proto-term">
      <pre ref={scroller} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}>{p.lines.join('\n')}</pre>
      {p.question && <div className="proto-question">? {p.question}</div>}
      <form onSubmit={e => { e.preventDefault(); const v = input.current!.value.trim(); if (v) { onReply(p.id, v); input.current!.value = ''; } }}>
        <span>›</span><input ref={input} placeholder={p.status === 'needs-input' ? '回复后按 Enter' : '输入给 Agent…'} />
      </form>
    </div>
  </div>;
}

export function Rail({ ephemeral, open, wide, onToggleWide, toggleOpen, addEphemeral }: { ephemeral: Pane[]; open?: string; wide: boolean; onToggleWide(): void; toggleOpen(id: string): void; addEphemeral(): void }) {
  const railWide = wide;
  return <aside className={`proto-rail ${railWide ? 'wide' : ''}`} aria-label="临时面板">
            <button className="proto-rail-toggle" title={railWide ? '收窄' : '展开标题'} onClick={onToggleWide}>{railWide ? '›' : '‹'}</button>
            {ephemeral.map(p => <button key={p.id} className={`proto-rail-item ${p.agent} status-${p.status} ${open === p.id ? 'open' : ''}`} title={`${statusName[p.status]} · ${p.title}`} onClick={() => toggleOpen(p.id)}>
              <span className="proto-rail-icon"><span className="agent-mark">{agentIcons[p.agent]}</span><ProcessingStatusIcon state={p.status} /></span>
              {railWide && <span className="proto-rail-text"><span className="session-title">{p.title}</span><small>{statusName[p.status]}</small></span>}
            </button>)}
            <button className="proto-rail-item proto-rail-add" title="新临时面板" onClick={addEphemeral}>＋</button>
  </aside>;
}

export function SummaryBar({ count }: { count(state: ProcessingState): number }) {
  return <footer className="project-summary"><div className="summary-entries">{(['ready', 'needs-input', 'done', 'error'] as const).map(s =>
      <button key={s} className="summary-entry" disabled={!count(s)}><ProcessingStatusIcon state={s} /><span>{count(s)}<span className="summary-name"> {statusName[s]}</span></span></button>)}
      <span className="proto-summary-note">底栏汇总位置由 #126 决定，这里只是占位</span></div></footer>;
}
