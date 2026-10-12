import { sessionTitle } from '../shared/session-title';
import { agentIcons } from './agent-icons';
import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type PointerEvent, type Ref } from 'react';
import { agentNames, type Layout, type Project, type Run } from '../shared/model';
import { layoutBoxes, type Divider } from '../shared/layout';
import { focusTerminal, mountTerminal, observePanel, terminalCellSize } from './terminals';
import { AgentPicker } from './AgentPicker';
import { beginPanelDrag } from './panel-drag';
import type { ShortcutAction } from '../shared/shortcuts';

export interface WorkspaceActions { shortcut(action: ShortcutAction): boolean }

function TerminalView({ run }: { run?: Run }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
  useEffect(() => { if (container.current) return observePanel(container.current, run?.id); }, [run?.id]);
  return <div className="terminal-container" ref={container}>{run?.state === 'starting' ? <div className="terminal-message">启动结果未确认，正在等待终端响应</div> : run?.state === 'failed' ? <div className="terminal-message">Agent 无法启动</div> : run?.state === 'stopped' ? <div className="terminal-message">运行已结束，请重新打开工作台</div> : !run ? <div className="terminal-message muted">正在启动…</div> : null}</div>;
}

export function Workspace({ project, runs, report, selectedPanelId, selectPanel, focusRequest, maximizedPanelId, maximizePanel, locatePanel, visible, ref }: { project: Project; runs: Run[]; report(message: string): void; selectedPanelId?: string; focusRequest?: number; maximizedPanelId?: string; maximizePanel(panelId?: string): void; locatePanel(panelId: string): void; selectPanel(panelId: string): void; visible: boolean; ref: Ref<WorkspaceActions> }) {
  const [layout, setLayout] = useState(project.layout);
  const focused = project.panels.some(panel => panel.id === selectedPanelId) ? selectedPanelId : project.panels[0]?.id;
  const focusedRun = runs.find(run => run.panelId === focused && run.state === 'running');
  const maximized = project.panels.some(panel => panel.id === maximizedPanelId) ? maximizedPanelId : undefined;
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => focusTerminal(focusedRun?.id));
    return () => cancelAnimationFrame(frame);
  }, [visible, focused, focusedRun?.id, focusRequest]);
  const [adding, setAdding] = useState(false);
  const cancelDrag = useRef<(() => void) | undefined>(undefined);
  const dragClick = useRef(false);
  const [resizing, setResizing] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  const savedLayout = useRef(project.layout);
  savedLayout.current = project.layout;
  // Run snapshots also contain the layout; only a changed arrangement cancels a gesture.
  const layoutKey = JSON.stringify(project.layout);
  function resetDrag() { cancelDrag.current?.(); cancelDrag.current = undefined; }
  useEffect(() => { cancelResize.current?.(); setLayout(savedLayout.current); resetDrag(); }, [layoutKey]);
  useEffect(() => { if (!visible) { cancelResize.current?.(); resetDrag(); } }, [visible]);
  useEffect(() => { if (maximizedPanelId && !maximized) maximizePanel(undefined); }, [maximizedPanelId, maximized]);
  useEffect(() => {
    const reset = () => { cancelResize.current?.(); resetDrag(); };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('blur', reset);
    window.addEventListener('keydown', keydown);
    return () => { reset(); window.removeEventListener('blur', reset); window.removeEventListener('keydown', keydown); };
  }, []);
  const positions = layoutBoxes(layout);
  const persist = (next: Layout | null) => { setLayout(next); void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  const focus = (panelId: string) => { selectPanel(panelId); focusTerminal(runs.find(r => r.panelId === panelId)?.id); };
  const maximize = (panelId: string) => { maximizePanel(maximized === panelId ? undefined : panelId); focus(panelId); };
  const close = (panelId: string) => { void window.workbench.closePanel(project.id, panelId).catch(error => report(error.message)); };
  useImperativeHandle(ref, () => ({ shortcut(action) {
    if (adding) return false;
    if (action === 'addPanel' && project.panels.length < 10) { setAdding(true); return true; }
    if (!focused) return false;
    if (action === 'closePanel') { close(maximized ?? focused); return true; }
    if (action === 'maximizePanel') { maximize(focused); return true; }
    if (action === 'nextPanel' || action === 'previousPanel') {
      const panels = [...positions.panels.keys()];
      const offset = action === 'nextPanel' ? 1 : -1;
      const next = panels[(panels.indexOf(focused) + offset + panels.length) % panels.length];
      locatePanel(next); return true;
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
    let node = original;
    for (const part of divider.path) { if ('panel' in node) return; node = node[part]; }
    if ('panel' in node) return;
    const originalRatio = node.ratio;
    const dimension = divider.axis === 'row' ? bounds.width : bounds.height;
    const start = divider.axis === 'row' ? event.clientX : event.clientY;
    const leaves = (branch: Layout): string[] => 'panel' in branch ? [branch.panel] : [...leaves(branch.first), ...leaves(branch.second)];
    const required = (id: string, share: number) => {
      const box = positions.panels.get(id)!;
      const slot = canvas.current!.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)!;
      const panel = slot.querySelector<HTMLElement>('.agent-panel')!;
      const slotStyle = getComputedStyle(slot), panelStyle = getComputedStyle(panel);
      const cell = terminalCellSize(runs.find(run => run.panelId === id)?.id);
      const row = divider.axis === 'row';
      const chrome = row ? parseFloat(slotStyle.paddingLeft) + parseFloat(slotStyle.paddingRight) + parseFloat(panelStyle.borderLeftWidth) + parseFloat(panelStyle.borderRightWidth)
        : parseFloat(slotStyle.paddingTop) + parseFloat(slotStyle.paddingBottom) + parseFloat(panelStyle.borderTopWidth) + parseFloat(panelStyle.borderBottomWidth);
      const current = (row ? box.width : box.height) * dimension;
      const minimum = (row ? cell.width : cell.height) * 2 + chrome;
      return minimum / (current / share);
    };
    const firstMinimum = Math.max(...leaves(node.first).map(id => required(id, originalRatio)));
    const secondMaximum = 1 - Math.max(...leaves(node.second).map(id => required(id, 1 - originalRatio)));
    let lower = Math.min(originalRatio, firstMinimum), upper = Math.max(originalRatio, secondMaximum);

    setResizing(true);
    element.setPointerCapture(event.pointerId);
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const candidate = structuredClone(original);
      let node = candidate;
      for (const part of divider.path) { if ('panel' in node) return; node = node[part]; }
      if ('panel' in node) return;
      const box = divider.box;
      const delta = (divider.axis === 'row' ? pointer.clientX : pointer.clientY) - start;
      const ratio = originalRatio + delta / (dimension * (divider.axis === 'row' ? box.width : box.height));
      node.ratio = lower <= upper ? Math.max(lower, Math.min(upper, ratio)) : originalRatio;
      // While an undersized leaf grows, it cannot surrender that space on reversal.
      // Once it reaches its normal minimum, ordinary bidirectional resizing resumes.
      lower = Math.max(lower, Math.min(node.ratio, firstMinimum));
      upper = Math.min(upper, Math.max(node.ratio, secondMaximum));
      next = candidate; setLayout(next);
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
  function drag(event: PointerEvent<HTMLElement>, panelId: string) {
    if (event.button !== 0 || maximized || !layout || (event.target as HTMLElement).closest('button, [role="menu"]')) return;
    event.preventDefault();
    cancelResize.current?.(); resetDrag(); dragClick.current = false;
    cancelDrag.current = beginPanelDrag({ event: event.nativeEvent, handle: event.currentTarget, canvas: canvas.current!, source: panelId,
      panels: project.panels, layout, commit: persist, consumed: () => { dragClick.current = true; }, ended: () => { cancelDrag.current = undefined; } });
  }
  const directoryEnd = project.directory.lastIndexOf('/');
  return <div className="workspace"><header className="workspace-toolbar"><strong title={project.name}>{project.name}</strong><span className="project-path" title={project.directory}><span className="path-parent">{project.directory.slice(0, directoryEnd)}</span><span className="path-leaf">{project.directory.slice(directoryEnd)}</span></span><span className="muted">{project.panels.length} 个面板</span><button aria-label="添加 Agent" disabled={project.panels.length >= 10} onClick={() => setAdding(true)}>＋</button></header>
    <div className={`canvas ${resizing ? 'resizing' : ''}`} ref={canvas}>
      {!project.panels.length && <div className="empty"><p>这个项目还没有 Agent 面板</p><button onClick={() => setAdding(true)}>＋ 添加 Agent</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        const run = runs.find(run => run.panelId === panel.id);
        const position: CSSProperties = maximized === panel.id ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return <section key={panel.id} data-panel-id={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused === panel.id ? 'focused' : ''}`}
          onMouseDown={event => { if (!(event.target as HTMLElement).closest('.panel-header')) selectPanel(panel.id); }} onFocusCapture={() => selectPanel(panel.id)}>
          <header className="panel-header" onPointerDown={event => drag(event, panel.id)} onClick={() => { if (dragClick.current) dragClick.current = false; else focus(panel.id); }}>
            <span className="agent-title" title={sessionTitle(run)}><span className="agent-mark">{agentIcons[panel.agent]}</span><span className="session-title">{sessionTitle(run)}</span></span><span className="panel-actions">
              <button aria-label={maximized === panel.id ? '还原面板' : '放大面板'} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); maximize(panel.id); }}>⤢</button>
              <button aria-label="关闭面板" draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); close(panel.id); }}>×</button>
            </span>
          </header><span className="tiny-agent-mark agent-mark" role="img" aria-label={agentNames[panel.agent]}>{agentIcons[panel.agent]}</span><TerminalView run={run} />
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
      added={() => { setAdding(false); maximizePanel(undefined); }} />}
  </div>;
}
