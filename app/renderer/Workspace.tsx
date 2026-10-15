import { sessionTitle } from '../shared/session-title';
import { agentIcons } from './agent-icons';
import { useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { type Layout, type Project, type Run } from '../shared/model';
import { layoutBoxes } from '../shared/layout';
import { focusTerminal, mountTerminal } from './terminals';
import { AgentPicker } from './AgentPicker';
import { createPanelInteractions, type PanelInteractionContext } from './panel-interactions';
import type { ShortcutAction } from '../shared/shortcuts';

export interface WorkspaceActions { shortcut(action: ShortcutAction): boolean }

function TerminalView({ run }: { run?: Run }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
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
  const canvas = useRef<HTMLDivElement>(null);
  const interactions = useRef<ReturnType<typeof createPanelInteractions> | null>(null);
  useEffect(() => { if (maximizedPanelId && !maximized) maximizePanel(undefined); }, [maximizedPanelId, maximized]);
  const positions = layoutBoxes(layout);
  const persist = (next: Layout) => { void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  useLayoutEffect(() => {
    const context: PanelInteractionContext = { projectId: project.id, layout: project.layout,
      panels: project.panels.map(panel => ({ ...panel, runId: runs.find(run => run.panelId === panel.id)?.id })),
      visible, maximizedPanelId: maximized, presentLayout: setLayout, commitLayout: persist };
    if (interactions.current) interactions.current.update(context);
    else interactions.current = createPanelInteractions(canvas.current!, context);
  });
  useLayoutEffect(() => () => { interactions.current?.dispose(); interactions.current = null; }, []);
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
  const directoryEnd = project.directory.lastIndexOf('/');
  return <div className="workspace"><header className="workspace-toolbar"><strong title={project.name}>{project.name}</strong><span className="project-path" title={project.directory}><span className="path-parent">{project.directory.slice(0, directoryEnd)}</span><span className="path-leaf">{project.directory.slice(directoryEnd)}</span></span><span className="muted">{project.panels.length} 个面板</span><button aria-label="添加 Agent" disabled={project.panels.length >= 10} onClick={() => setAdding(true)}>＋</button></header>
    <div className="canvas" ref={canvas}>
      {!project.panels.length && <div className="empty"><p>这个项目还没有 Agent 面板</p><button onClick={() => setAdding(true)}>＋ 添加 Agent</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        const run = runs.find(run => run.panelId === panel.id);
        const title = sessionTitle(panel.agent, run?.rawTitle);
        const position: CSSProperties = maximized === panel.id ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return <section key={panel.id} data-panel-id={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused === panel.id ? 'focused' : ''}`}
          onMouseDown={event => { if (!(event.target as HTMLElement).closest('.panel-header')) selectPanel(panel.id); }} onFocusCapture={() => selectPanel(panel.id)}>
          <header className="panel-header" onPointerDown={event => interactions.current?.startSwap(event.nativeEvent, event.currentTarget, panel.id)} onClick={() => focus(panel.id)}>
            <span className="agent-title" title={title}><span className="agent-mark">{agentIcons[panel.agent]}</span><span className="session-title">{title}</span></span><span className="panel-actions">
              <button aria-label={maximized === panel.id ? '还原面板' : '放大面板'} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); maximize(panel.id); }}>⤢</button>
              <button aria-label="关闭面板" draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); close(panel.id); }}>×</button>
            </span>
          </header><TerminalView run={run} />
        </div></section>;
      })}
      {!maximized && positions.dividers.map(divider => {
        const { box, axis, ratio } = divider;
        const style: CSSProperties = axis === 'row'
          ? { left: `calc(${(box.x + box.width * ratio) * 100}% - 4px)`, top: `${box.y * 100}%`, width: 8, height: `${box.height * 100}%`, cursor: 'col-resize' }
          : { left: `${box.x * 100}%`, top: `calc(${(box.y + box.height * ratio) * 100}% - 4px)`, height: 8, width: `${box.width * 100}%`, cursor: 'row-resize' };
        return <div key={divider.path.join('.')} role="separator" aria-orientation={axis === 'row' ? 'vertical' : 'horizontal'} className="divider" style={style} onPointerDown={event => interactions.current?.startResize(event.nativeEvent, event.currentTarget, divider)} />;
      })}
    </div>
    {adding && <AgentPicker projectId={project.id} full={project.panels.length >= 10} close={() => setAdding(false)}
      added={() => { setAdding(false); maximizePanel(undefined); }} />}
  </div>;
}
