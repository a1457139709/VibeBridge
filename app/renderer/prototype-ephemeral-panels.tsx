// PROTOTYPE — throwaway, lives only on branch `prototype/ephemeral-panels`. Never import or adapt into production
// (AGENTS.md「Prototype scope」). Question (#125): where ephemeral panels sit while quiet (?dock=) and how one is
// presented when opened (?view=), plus dragging panels between tray and layout. Fake data lives in the -data/-layout/-views/-options files.
import React, { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { Localization } from './Localization';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { agentIcons } from './agent-icons';
import type { ProcessingState } from '../shared/processing-status';
import './style.css';
import './processing-status.css';
import './project-summary.css';
import './prototype-ephemeral-panels.css';
import { Agent, Pane, statusName, agentName, chunk, log, questions, pane, initialPersistent, initialEphemeral, newTitles, initialTree } from './prototype-ephemeral-panels-data';
import { Tree, Box, boxes, splitLargest, Side, ROOT, Path, splitList, setRatio, splitAt, removeFrom, sideOf } from './prototype-ephemeral-panels-layout';
import { NavLink, PanelView, Rail, SummaryBar, ToolbarSummary } from './prototype-ephemeral-panels-views';
import { docks, views, columnModes, chromes, Chrome, ColumnMode, Dock, View, param, typing } from './prototype-ephemeral-panels-options';
import { Switcher, cycle } from './prototype-ephemeral-panels-switcher';



// ---- app ---------------------------------------------------------------------------------------------------
function Prototype() {
  const [dock, setDock] = useState<Dock>(() => param('dock', docks.map(d => d.key), 'tray'));
  const [view, setView] = useState<View>(() => param('view', views.map(v => v.key), 'maximize'));
  const [columnMode, setColumnMode] = useState<ColumnMode>(() => param('column', columnModes.map(m => m.key), 'push'));
  const [theme, setTheme] = useState(() => param('theme', ['dark', 'light'], 'dark'));
  const [chrome, setChrome] = useState<Chrome>(() => param('chrome', chromes.map(c => c.key), 'top'));
  const [page, setPage] = useState<'workspace' | 'settings'>('workspace');
  const [persistent, setPersistent] = useState(initialPersistent);
  const [ephemeral, setEphemeral] = useState(initialEphemeral);
  const [tree, setTree] = useState<Tree | null>(initialTree);
  const [drag, setDrag] = useState<{ id: string; from: 'tray' | 'layout' }>();
  const [drop, setDrop] = useState<{ target: string; side: Side } | 'tray'>();
  const [focused, setFocused] = useState('p1');
  const [open, setOpen] = useState<string>();
  const [running, setRunning] = useState(true);
  const [railWide, setRailWide] = useState(false);
  const [columnWidth, setColumnWidth] = useState(0.46);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('dock', dock); url.searchParams.set('view', view); url.searchParams.set('theme', theme); url.searchParams.set('column', columnMode); url.searchParams.set('chrome', chrome);
    history.replaceState(null, '', url);
  }, [dock, view, theme, columnMode, chrome]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open && !typing(event.target)) { setOpen(undefined); return; }
      if (typing(event.target)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') setDock(d => cycle(docks, d, event.key === 'ArrowLeft' ? -1 : 1));
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setView(v => cycle(views, v, event.key === 'ArrowUp' ? -1 : 1)); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [open]);
  // Busy panes keep printing; when their budget runs out they land on Needs input or Turn ended.
  useEffect(() => {
    if (!running) return;
    const advance = (list: Pane[]) => list.map(p => {
      if (p.status !== 'busy') return p;
      const lines = [...p.lines, ...chunk(p.tick)];
      if (p.remaining > 1) return { ...p, lines, remaining: p.remaining - 1, tick: p.tick + 1 };
      const question = p.next === 'needs-input' ? questions[p.tick % questions.length] : undefined;
      return { ...p, lines: question ? [...lines, '', `? ${question}`] : [...lines, '', '⏺ 本轮完成。'], status: p.next, question, tick: p.tick + 1 };
    });
    const timer = setInterval(() => { setEphemeral(advance); setPersistent(advance); }, 1400);
    return () => clearInterval(timer);
  }, [running]);

  const reply = (id: string, text: string) => {
    const update = (list: Pane[]) => list.map(p => p.id !== id ? p : { ...p, status: 'busy' as const, question: undefined, lines: [...p.lines, '', `> ${text}`], remaining: 4 + p.tick % 5, next: (p.tick % 2 ? 'done' : 'needs-input') as ProcessingState });
    setEphemeral(update); setPersistent(update);
  };
  const addEphemeral = () => {
    const n = ephemeral.length + persistent.length + Date.now() % 97;
    const id = `e${Date.now()}`;
    setEphemeral(list => [...list, pane(id, (['claude', 'codex', 'pi'] as const)[n % 3], newTitles[n % newTitles.length], 'busy', n, { lines: log(n, newTitles[n % newTitles.length], 3), remaining: 6, next: 'needs-input' })]);
  };
  const exitEphemeral = (id: string) => { setEphemeral(list => list.filter(p => p.id !== id)); if (open === id) setOpen(undefined); };
  const pin = (id: string) => {
    const p = ephemeral.find(e => e.id === id);
    if (!p) return;
    setEphemeral(list => list.filter(e => e.id !== id)); setPersistent(list => [...list, p]);
    setTree(t => t ? splitLargest(t, id) : { panel: id }); setOpen(undefined); setFocused(id);
  };
  const toggleOpen = (id: string) => setOpen(current => current === id ? undefined : id);

  const opened = ephemeral.find(p => p.id === open);
  const layout = tree ? boxes(tree) : new Map<string, Box>();
  const startDrag = (id: string, from: 'tray' | 'layout') => (event: React.DragEvent) => {
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id);
    setOpen(undefined); setTimeout(() => setDrag({ id, from }));
  };
  const canvas = useRef<HTMLDivElement>(null);
  const startResize = (path: Path, axis: 'row' | 'column', box: Box) => (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = canvas.current!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    const move = (e: PointerEvent) => {
      const at = axis === 'row' ? ((e.clientX - rect.left) / rect.width - box.x) / box.w : ((e.clientY - rect.top) / rect.height - box.y) / box.h;
      setTree(t => t && setRatio(t, path, Math.min(0.9, Math.max(0.1, at))));
    };
    const up = () => { document.body.classList.remove('resizing'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const endDrag = () => { setDrag(undefined); setDrop(undefined); };
  const dropOnPanel = (target: string, side: Side) => {
    if (!drag || drag.id === target) return endDrag();
    const p = ephemeral.find(e => e.id === drag.id);
    if (p) { setEphemeral(list => list.filter(e => e.id !== p.id)); setPersistent(list => [...list, p]); }
    setTree(t => splitAt(removeFrom(t, drag.id), target, drag.id, side)); setFocused(drag.id); endDrag();
  };
  const dropOnTray = () => {
    const p = drag?.from === 'layout' ? persistent.find(e => e.id === drag.id) : undefined;
    if (p) { setPersistent(list => list.filter(e => e.id !== p.id)); setEphemeral(list => [...list, p]); setTree(t => removeFrom(t, p.id)); }
    endDrag();
  };
  const all = [...persistent, ...ephemeral];
  const count = (s: ProcessingState) => all.filter(p => p.status === s).length;
  const slotTarget = view === 'slot' && opened ? (layout.has(focused) ? focused : persistent[0]?.id) : undefined;

  const openedPanel = opened && <PanelView pane={opened} ephemeral focused onReply={reply}
    note={view === 'slot' && slotTarget ? `暂代「${persistent.find(p => p.id === slotTarget)?.title}」的位置` : undefined}
    actions={<>
      <button title="固定为常驻面板（按现行规则切开最大面板）" onClick={() => pin(opened.id)}>⇱</button>
      <button title="收起，回到原布局（Esc）" onClick={() => setOpen(undefined)}>⌄</button>
      <button title="关闭（等同 Agent 退出）" onClick={() => exitEphemeral(opened.id)}>×</button>
    </>} />;

  const startColumnResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const width = stage.current!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => setColumnWidth(Math.min(0.75, Math.max(0.25, (width.right - e.clientX) / width.width)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const top = chrome === 'top';
  const inWorkspace = page === 'workspace';
  const locate = (id: string) => { setPage('workspace'); if (ephemeral.some(p => p.id === id)) setOpen(id); else { setOpen(undefined); setFocused(id); } };
  return <Localization language="zh-CN"><div className={`app proto ${top ? 'proto-top' : ''}`}>
    <header className="system-bar"><div className="system-brand"><button aria-hidden>☷</button><span className="wordmark">VibeBridge</span></div>
    </header>
      <Switcher {...{ chrome, setChrome, dock, setDock, view, setView, columnMode, setColumnMode, theme, setTheme, running, setRunning, addEphemeral, canAdd: ephemeral.length < 6,
        state: `打开：${opened ? opened.title : '—'} · 焦点：${all.find(p => p.id === focused)?.title ?? '—'}` }} />
    <div className="app-body">
      <nav className="navigation" style={{ '--navigation-width': '230px' } as CSSProperties}>
        <div className="navigation-projects"><div className="nav-heading">项目</div>
          <section className="project-group">
            <div className="proto-project-row"><button className="project-disclosure">⌄</button><button className="project-link selected"><span className="project-initial">V</span><span className="project-name">VibeBridge</span><small>{persistent.length + ephemeral.length}</small></button></div>
            <div className="project-panels">
              {persistent.map(p => <NavLink key={p.id} pane={p} selected={!opened && focused === p.id} onClick={() => { setOpen(undefined); setFocused(p.id); }} />)}
              {dock === 'nav' && !!ephemeral.length && <>
                <div className="proto-nav-sub">临时 · {ephemeral.length}</div>
                {ephemeral.map(p => <NavLink key={p.id} pane={p} ephemeral selected={open === p.id} onClick={() => toggleOpen(p.id)} />)}
                <button className="panel-link proto-nav-add" onClick={addEphemeral}>＋ 临时面板</button>
              </>}
            </div>
          </section>
          <section className="project-group"><div className="proto-project-row"><button className="project-disclosure">›</button><button className="project-link"><span className="project-initial">B</span><span className="project-name">blog</span><small>2</small></button></div></section>
          <button className="add-project"><span>＋</span>添加项目</button>
        </div>
        <div className="nav-footer"><span>本地工作台</span><button className={`settings-entry ${page === 'settings' ? 'selected' : ''}`} title="模拟进入／离开设置页" onClick={() => { setOpen(undefined); setPage(p => p === 'settings' ? 'workspace' : 'settings'); }}>⚙</button></div>
      </nav>
      <main>{!inWorkspace && <div className="proto-settings"><h2>设置</h2><p className="muted">（模拟设置页：{top ? '工作区工具栏（项目名、汇总、＋）随工作区隐藏，状态只看左侧项目导航' : '旧版：底栏汇总仍然显示'}。点左下角 ⚙ 返回工作区。）</p></div>}
      <div className="workbench-page" hidden={!inWorkspace}><div className="workspace">
        {top ? <header className="workspace-toolbar proto-toolbar-summary"><span className="proto-tb-left" /><ToolbarSummary panes={all} ephemeralIds={new Set(ephemeral.map(p => p.id))} onLocate={locate} /><button className="proto-tb-add" title="新增常驻面板">＋</button></header> :
        <header className="workspace-toolbar"><strong>VibeBridge</strong><span className="project-path"><span className="path-parent">/Users/red/Project</span><span className="path-leaf">/VibeBridge</span></span>
          {dock === 'toolbar' ? <span className="proto-chips">{ephemeral.map(p => <button key={p.id} className={`proto-chip ${p.agent} status-${p.status} ${open === p.id ? 'open' : ''}`} title={`${statusName[p.status]} · ${p.title}`} onClick={() => toggleOpen(p.id)}>
            <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span><span className="session-title">{p.title}</span></button>)}</span>
            : <span className="muted">{persistent.length} 个常驻{ephemeral.length ? ` · ${ephemeral.length} 个临时` : ''}</span>}
          <button title="新增常驻面板">＋</button>
        </header>}
        <div className="proto-stage" ref={stage}>
          <div className="canvas proto-canvas" ref={canvas} onDragOver={e => { if (drag && !tree) e.preventDefault(); }} onDrop={() => { if (drag && !tree) { const p = ephemeral.find(x => x.id === drag.id); if (p) { setEphemeral(l => l.filter(x => x.id !== p.id)); setPersistent(l => [...l, p]); setTree({ panel: p.id }); } endDrag(); } }}>
            {!tree && <div className="proto-empty">{drag ? '松手放进布局' : '布局为空：从托盘拖一个面板上来'}</div>}
            {persistent.map(p => {
              const b = layout.get(p.id);
              if (!b) return null;
              const hidden = (view === 'maximize' && opened) || slotTarget === p.id;
              const preview = drop && drop !== 'tray' && drop.target === p.id ? drop.side : undefined;
              return <section key={p.id} className={`panel-slot ${p.agent}`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, visibility: hidden ? 'hidden' : 'visible' }}
                onDragOver={e => { if (!drag || drag.id === p.id) return; e.preventDefault(); const side = sideOf(e); setDrop(d => d && d !== 'tray' && d.target === p.id && d.side === side ? d : { target: p.id, side }); }}
                onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(d => d !== 'tray' && d?.target === p.id ? undefined : d); }}
                onDrop={e => { e.preventDefault(); dropOnPanel(p.id, sideOf(e)); }}>
                <PanelView pane={p} focused={!opened && focused === p.id} onFocus={() => setFocused(p.id)} onReply={reply} onHeaderDragStart={startDrag(p.id, 'layout')} onDragEnd={endDrag} actions={<><button title="放大面板">⤢</button><button title="关闭面板">×</button></>} />
                {preview && <div className={`proto-drop proto-drop-${preview}`}>{drag?.from === 'tray' ? '放到这里，成为常驻面板' : '移到这里'}</div>}
              </section>;
            })}
            {tree && !(view === 'maximize' && opened) && splitList(tree).map(d => {
              const at = d.axis === 'row' ? d.box.x + d.box.w * d.ratio : d.box.y + d.box.h * d.ratio;
              const style: CSSProperties = d.axis === 'row'
                ? { left: `calc(${at * 100}% - 4px)`, top: `${d.box.y * 100}%`, height: `${d.box.h * 100}%`, width: 8, cursor: 'col-resize' }
                : { top: `calc(${at * 100}% - 4px)`, left: `${d.box.x * 100}%`, width: `${d.box.w * 100}%`, height: 8, cursor: 'row-resize' };
              return <div key={d.path.join('.') || 'root'} className="divider proto-divider" style={style} onPointerDown={startResize(d.path, d.axis, d.box)} />;
            })}
            {drag && tree && (['left', 'right', 'top', 'bottom'] as const).map(side => <div key={side} className={`proto-edge proto-edge-${side}`}
              onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDrop(d => d && d !== 'tray' && d.target === ROOT && d.side === side ? d : { target: ROOT, side }); }}
              onDragLeave={() => setDrop(d => d !== 'tray' && d?.target === ROOT && d.side === side ? undefined : d)}
              onDrop={e => { e.preventDefault(); e.stopPropagation(); dropOnPanel(ROOT, side); }} />)}
            {drop && drop !== 'tray' && drop.target === ROOT && <div className={`proto-drop proto-drop-${drop.side} proto-drop-root`}>放到整个布局的{({ left: '左侧', right: '右侧', top: '上方', bottom: '下方' })[drop.side]}</div>}
            {opened && view === 'maximize' && <section className={`panel-slot ${opened.agent} proto-pop`} style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 3 }}>{openedPanel}</section>}
            {opened && slotTarget && (() => { const b = layout.get(slotTarget)!; return <section className={`panel-slot ${opened.agent} proto-pop`} style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, zIndex: 3 }}>{openedPanel}</section>; })()}
          </div>
          {opened && view === 'column' && <div className={`proto-column ${opened.agent} ${columnMode === 'overlay' ? 'proto-column-overlay' : ''}`} style={columnMode === 'overlay' ? { width: `${columnWidth * 100}%` } : { flexBasis: `${columnWidth * 100}%` }}>
            <div className="proto-column-resize" onPointerDown={startColumnResize} />
            <div className="proto-column-inner">{openedPanel}</div>
          </div>}
          {dock === 'rail' && <Rail ephemeral={ephemeral} open={open} wide={railWide} onToggleWide={() => setRailWide(w => !w)} toggleOpen={toggleOpen} addEphemeral={addEphemeral} />}
        </div>
        {dock === 'tray' && <div className={`proto-tray ${drop === 'tray' ? 'proto-tray-drop' : ''}`} aria-label="临时面板托盘"
          onDragOver={e => { if (drag?.from !== 'layout') return; e.preventDefault(); setDrop('tray'); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(d => d === 'tray' ? undefined : d); }}
          onDrop={e => { e.preventDefault(); dropOnTray(); }}>
          {drop === 'tray' && <span className="proto-tray-hint">松手放回托盘，成为临时面板</span>}
          {ephemeral.map(p => <button key={p.id} draggable onDragStart={startDrag(p.id, 'tray')} onDragEnd={endDrag} className={`proto-card ${p.agent} status-${p.status} ${open === p.id ? 'open' : ''}`} title={`${agentName[p.agent]} · ${p.title}`} onClick={() => toggleOpen(p.id)}>
            <span className="agent-symbols"><ProcessingStatusIcon state={p.status} /><span className="agent-mark">{agentIcons[p.agent]}</span></span>
            <span className="session-title">{p.title}</span><small>{statusName[p.status]}</small>
          </button>)}
          <button className="proto-card proto-card-add" title="新临时面板" onClick={addEphemeral}>＋</button>
        </div>}
      </div></div></main>
    </div>
    {!top && <SummaryBar count={count} />}
  </div></Localization>;
}


createRoot(document.getElementById('root')!).render(<Prototype />);