import { agentIcons } from './agent-icons';
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type PointerEvent, type Ref } from 'react';
import { agentNames, type Layout, type Project, type Run } from '../shared/model';
import { layoutBoxes, type Divider } from '../shared/layout';
import { focusTerminal, mountTerminal } from './terminals';
import { AgentPicker } from './AgentPicker';
import type { ShortcutAction } from '../shared/shortcuts';

export interface WorkspaceActions { shortcut(action: ShortcutAction): boolean }

function TerminalView({ run }: { run?: Run }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
  return <div className="terminal-container" ref={container}>{run?.state === 'failed' ? <div className="terminal-message">Agent 无法启动</div> : run?.state === 'stopped' ? <div className="terminal-message">运行已结束，请重新打开工作台</div> : !run ? <div className="terminal-message muted">正在启动…</div> : null}</div>;
}

export function Workspace({ project, runs, report, selectedPanelId, selectPanel, visible, ref }: { project: Project; runs: Run[]; report(message: string): void; selectedPanelId?: string; selectPanel(panelId: string): void; visible: boolean; ref: Ref<WorkspaceActions> }) {
  const [layout, setLayout] = useState(project.layout);
  const focused = project.panels.some(panel => panel.id === selectedPanelId) ? selectedPanelId : project.panels[0]?.id;
  const focusedRun = runs.find(run => run.panelId === focused && run.state === 'running');
  const [maximized, setMaximized] = useState<string>();
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => focusTerminal(focusedRun?.id));
    return () => cancelAnimationFrame(frame);
  }, [visible, focused, focusedRun?.id]);
  const [adding, setAdding] = useState(false);
  const [dragged, setDragged] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [menuPanel, setMenuPanel] = useState<string>();
  const [resizing, setResizing] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  const savedLayout = useRef(project.layout);
  savedLayout.current = project.layout;
  // Run snapshots also contain the layout; only a changed arrangement cancels a gesture.
  const layoutKey = JSON.stringify(project.layout);
  function resetDrag() { setDragged(undefined); setDropTarget(undefined); }
  useEffect(() => { cancelResize.current?.(); setLayout(savedLayout.current); resetDrag(); }, [layoutKey]);
  useEffect(() => { if (maximized && !project.panels.some(p => p.id === maximized)) setMaximized(undefined); }, [project.panels, maximized]);
  useEffect(() => {
    const reset = () => { cancelResize.current?.(); resetDrag(); setMenuPanel(undefined); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', keydown);
    return () => { reset(); window.removeEventListener('blur', reset); window.removeEventListener('keydown', keydown); };
  }, []);
  const positions = layoutBoxes(layout);
  const persist = (next: Layout | null) => { setLayout(next); void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  const focus = (panelId: string) => { selectPanel(panelId); focusTerminal(runs.find(r => r.panelId === panelId)?.id); };
  const maximize = (panelId: string) => { setMenuPanel(undefined); setMaximized(maximized === panelId ? undefined : panelId); focus(panelId); };
  const close = (panelId: string) => { setMenuPanel(undefined); void window.workbench.closePanel(project.id, panelId).catch(error => report(error.message)); };
  useImperativeHandle(ref, () => ({ shortcut(action) {
    if (adding) return false;
    if (action === 'addPanel' && project.panels.length < 10) { setAdding(true); return true; }
    if (!focused) return false;
    if (action === 'maximizePanel') { maximize(focused); return true; }
    if (action === 'nextPanel' || action === 'previousPanel') {
      const panels = [...positions.panels.keys()];
      const offset = action === 'nextPanel' ? 1 : -1;
      const next = panels[(panels.indexOf(focused) + offset + panels.length) % panels.length];
      if (maximized) setMaximized(next);
      focus(next); return true;
    }
    return false;
  } }));
  function resize(event: PointerEvent<HTMLDivElement>, divider: Divider) {
    if (event.button !== 0) return;
    event.preventDefault();
    cancelResize.current?.();
    const element = event.currentTarget;
    const bounds = canvas.current!.getBoundingClientRect();
    const original = structuredClone(layout)!;
    let next = original;
    setResizing(true);
    element.setPointerCapture(event.pointerId);
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const candidate = structuredClone(original);
      let node = candidate;
      for (const part of divider.path) { if ('panel' in node) return; node = node[part]; }
      if ('panel' in node) return;
      const box = divider.box;
      const ratio = divider.axis === 'row' ? ((pointer.clientX - bounds.left) / bounds.width - box.x) / box.width
        : ((pointer.clientY - bounds.top) / bounds.height - box.y) / box.height;
      if (ratio <= 0 || ratio >= 1) return;
      node.ratio = ratio; next = candidate; setLayout(next);
    };
    const finish = (commit: boolean) => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel); element.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('resize', cancel);
      cancelResize.current = undefined;
      setResizing(false);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (commit) persist(next); else setLayout(savedLayout.current);
    };
    const up = (pointer: globalThis.PointerEvent) => { if (pointer.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    cancelResize.current = cancel;
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel); element.addEventListener('lostpointercapture', cancel);
    window.addEventListener('resize', cancel);
  }
  function swap(target: string) {
    if (dragged && dragged !== target && layout) {
      const change = (node: Layout): Layout => 'panel' in node ? { panel: node.panel === dragged ? target : node.panel === target ? dragged : node.panel }
        : { ...node, first: change(node.first), second: change(node.second) };
      persist(change(layout));
    }
    resetDrag();
  }
  const directoryEnd = project.directory.lastIndexOf('/');
  return <div className="workspace"><header className="workspace-toolbar"><strong title={project.name}>{project.name}</strong><span className="project-path" title={project.directory}><span className="path-parent">{project.directory.slice(0, directoryEnd)}</span><span className="path-leaf">{project.directory.slice(directoryEnd)}</span></span><span className="muted">{project.panels.length} 个面板</span><button aria-label="添加 Agent" disabled={project.panels.length >= 10} onClick={() => setAdding(true)}>＋</button></header>
    <div className={`canvas ${resizing ? 'resizing' : ''}`} ref={canvas} onMouseDown={() => setMenuPanel(undefined)}>
      {!project.panels.length && <div className="empty"><p>这个项目还没有 Agent 面板</p><button onClick={() => setAdding(true)}>＋ 添加 Agent</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        const run = runs.find(run => run.panelId === panel.id);
        const position: CSSProperties = maximized === panel.id ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return <section key={panel.id} data-panel-id={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused === panel.id ? 'focused' : ''} ${dropTarget === panel.id ? 'drop-target' : ''}`}
          onMouseDown={() => selectPanel(panel.id)} onFocusCapture={() => selectPanel(panel.id)}
          onDragOver={event => { if (dragged && dragged !== panel.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(panel.id); } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(undefined); }}
          onDrop={event => { if (dragged) { event.preventDefault(); swap(panel.id); } }}>
          <header className="panel-header" draggable={!maximized} onDragStart={event => {
            if ((event.target as HTMLElement).closest('button, [role="menu"]')) { event.preventDefault(); return; }
            setMenuPanel(undefined); setDragged(panel.id); event.dataTransfer.setData('text/plain', panel.id); event.dataTransfer.effectAllowed = 'move';
          }} onDragEnd={resetDrag} onClick={() => focus(panel.id)}>
            <span className="agent-title"><span className="agent-mark">{agentIcons[panel.agent]}</span>{agentNames[panel.agent]}</span><span className="panel-actions">
              <button aria-label={maximized === panel.id ? '还原面板' : '放大面板'} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); maximize(panel.id); }}>⤢</button>
              <button aria-label="更多面板操作" aria-expanded={menuPanel === panel.id} aria-haspopup="menu" draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setMenuPanel(menuPanel === panel.id ? undefined : panel.id); }}>⋯</button>
              <button aria-label="关闭面板" draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); close(panel.id); }}>×</button>
            </span>
          </header>{menuPanel === panel.id && <div className="panel-menu" role="menu" onMouseDown={event => event.stopPropagation()}>
            <button role="menuitem" autoFocus onClick={() => maximize(panel.id)}>{maximized === panel.id ? '还原面板' : '放大面板'}</button>
            <button role="menuitem" onClick={() => close(panel.id)}>关闭面板</button>
          </div>}<TerminalView run={run} />
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
    {adding && <AgentPicker projectId={project.id} full={project.panels.length >= 10} close={() => setAdding(false)}
      added={() => { setAdding(false); setMaximized(undefined); }} />}
  </div>;
}
