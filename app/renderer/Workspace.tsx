import { agentIcons } from './agent-icons';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { agentNames, agentTypes, type Layout, type Project, type Run } from '../shared/model';
import { layoutBoxes, type Divider } from './layout';
import { focusTerminal, mountTerminal } from './terminals';

function TerminalView({ run }: { run?: Run }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
  return <div className="terminal-container" ref={container}>{run?.state === 'failed' ? <div className="terminal-message">Agent 无法启动</div> : !run ? <div className="terminal-message muted">正在启动…</div> : null}</div>;
}

export function Workspace({ project, runs, report }: { project: Project; runs: Run[]; report(message: string): void }) {
  const [layout, setLayout] = useState(project.layout);
  const [focused, setFocused] = useState<string>();
  const [maximized, setMaximized] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [addingBusy, setAddingBusy] = useState(false);
  const [dragged, setDragged] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const canvas = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  useEffect(() => { if (!dragging.current) setLayout(project.layout); }, [project.layout]);
  useEffect(() => { if (maximized && !project.panels.some(p => p.id === maximized)) setMaximized(undefined); }, [project.panels, maximized]);
  useEffect(() => {
    const reset = () => { setDragged(undefined); setDropTarget(undefined); };
    window.addEventListener('blur', reset);
    return () => window.removeEventListener('blur', reset);
  }, []);
  const positions = layoutBoxes(layout);
  const persist = (next: Layout | null) => { setLayout(next); void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  const focus = (panelId: string) => { setFocused(panelId); focusTerminal(runs.find(r => r.panelId === panelId)?.id); };
  function resize(event: PointerEvent<HTMLDivElement>, divider: Divider) {
    event.preventDefault();
    const element = event.currentTarget;
    const bounds = canvas.current!.getBoundingClientRect();
    const original = structuredClone(layout)!;
    let next = original;
    dragging.current = true;
    element.setPointerCapture(event.pointerId);
    const move = (pointer: globalThis.PointerEvent) => {
      next = structuredClone(original);
      let node = next;
      for (const part of divider.path) { if ('panel' in node) return; node = node[part]; }
      if ('panel' in node) return;
      const box = divider.box;
      const ratio = divider.axis === 'row' ? ((pointer.clientX - bounds.left) / bounds.width - box.x) / box.width
        : ((pointer.clientY - bounds.top) / bounds.height - box.y) / box.height;
      node.ratio = Math.max(0.02, Math.min(0.98, ratio)); setLayout(next);
    };
    const finish = (pointer: globalThis.PointerEvent) => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', finish); element.removeEventListener('pointercancel', finish);
      dragging.current = false;
      if (element.hasPointerCapture(pointer.pointerId)) element.releasePointerCapture(pointer.pointerId);
      persist(pointer.type === 'pointercancel' ? original : next);
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', finish); element.addEventListener('pointercancel', finish);
  }
  function swap(target: string) {
    if (dragged && dragged !== target && layout) {
      const change = (node: Layout): Layout => 'panel' in node ? { panel: node.panel === dragged ? target : node.panel === target ? dragged : node.panel }
        : { ...node, first: change(node.first), second: change(node.second) };
      persist(change(layout));
    }
    setDragged(undefined); setDropTarget(undefined);
  }
  return <div className="workspace"><header className="workspace-toolbar"><strong>{project.name}</strong><span className="project-path" title={project.directory}>{project.directory}</span><span className="muted">{project.panels.length} 个面板</span><button aria-label="添加 Agent" disabled={project.panels.length >= 10} onClick={() => setAdding(true)}>＋</button></header>
    <div className="canvas" ref={canvas}>
      {!project.panels.length && <div className="empty"><p>这个项目还没有 Agent 面板</p><button onClick={() => setAdding(true)}>＋ 添加 Agent</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        const run = runs.find(run => run.panelId === panel.id);
        const position: CSSProperties = maximized === panel.id ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return <section key={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused === panel.id ? 'focused' : ''} ${dropTarget === panel.id ? 'drop-target' : ''}`} onMouseDown={() => setFocused(panel.id)}>
          <header className="panel-header" draggable onDragStart={event => { setDragged(panel.id); event.dataTransfer.setData('text/plain', panel.id); event.dataTransfer.effectAllowed = 'move'; }} onDragOver={event => { if (dragged) { event.preventDefault(); setDropTarget(panel.id); } }} onDrop={event => { event.preventDefault(); swap(panel.id); }} onDragEnd={() => { setDragged(undefined); setDropTarget(undefined); }} onClick={() => focus(panel.id)}>
            <span className="agent-title"><span className="agent-mark">{agentIcons[panel.agent]}</span>{agentNames[panel.agent]}</span><span className="panel-actions">
              <button aria-label={maximized === panel.id ? '还原面板' : '放大面板'} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMaximized(maximized === panel.id ? undefined : panel.id); }}>⤢</button>
              <button aria-label="关闭面板" draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); void window.workbench.closePanel(project.id, panel.id).catch(error => report(error.message)); }}>×</button>
            </span>
          </header><TerminalView run={run} />
        </div></section>;
      })}
      {!maximized && positions.dividers.map(divider => {
        const { box, axis, ratio } = divider;
        const style: CSSProperties = axis === 'row'
          ? { left: `calc(${(box.x + box.width * ratio) * 100}% - 4px)`, top: `${box.y * 100}%`, width: 8, height: `${box.height * 100}%`, cursor: 'col-resize' }
          : { left: `${box.x * 100}%`, top: `calc(${(box.y + box.height * ratio) * 100}% - 4px)`, height: 8, width: `${box.width * 100}%`, cursor: 'row-resize' };
        return <div key={divider.path.join('.')} role="separator" aria-orientation={axis === 'row' ? 'vertical' : 'horizontal'} className="divider" style={style} onPointerDown={event => resize(event, divider)} />;
      })}
    </div>
    {adding && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAdding(false); }}><div className="agent-picker" role="dialog" aria-modal="true" aria-label="添加 Agent" onKeyDown={event => { if (event.key === 'Escape') setAdding(false); }}><button className="picker-close" aria-label="关闭添加 Agent" onClick={() => setAdding(false)}>×</button>{agentTypes.map(type => <button key={type} autoFocus={type === 'codex'} className={`agent-option ${type}`} disabled={addingBusy} onClick={async () => { setAddingBusy(true); try { await window.workbench.addPanel(project.id, type); setAdding(false); } catch (error) { report((error as Error).message); } finally { setAddingBusy(false); } }}><span className="agent-mark">{agentIcons[type]}</span>{agentNames[type]}</button>)}</div></div>}
  </div>;
}
