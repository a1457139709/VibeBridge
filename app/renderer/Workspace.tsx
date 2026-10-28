import { useLocalization } from './Localization';
import { agentIcons } from './agent-icons';
import { useLayoutEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from 'react';
import { type Layout, type ProjectView, type Run } from '../shared/model';
import { layoutBoxes } from '../shared/layout';
import { mountTerminal } from './terminals';
import { AgentPicker } from './AgentPicker';
import { createPanelInteractions, type PanelInteractionContext } from './panel-interactions';
import type { ShortcutAction } from '../shared/shortcuts';
import { useWorkspacePanelLocation, type PanelLocation } from './panel-location';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';

export interface WorkspaceActions { shortcut(action: ShortcutAction): boolean }

function TerminalView({ run }: { run?: Run }) {
  const { t } = useLocalization();
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
  return <div className="terminal-container" ref={container}>{run?.state === 'starting' ? <div className="terminal-message">{t('launchPending')}</div> : run?.state === 'failed' ? <div className="terminal-message">{t('launchFailed')}</div> : run?.state === 'stopped' ? <div className="terminal-message">{t('runStopped')}</div> : !run ? <div className="terminal-message muted">{t('starting')}</div> : null}</div>;
}

export function Workspace({ project, report, openAgentSettings, location, visible, ref }: { project: ProjectView; report(message: string): void; openAgentSettings(): void; location: PanelLocation; visible: boolean; ref: Ref<WorkspaceActions> }) {
  const { t, language } = useLocalization();
  const [layout, setLayout] = useState(project.layout);
  const [adding, setAdding] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const interactions = useRef<ReturnType<typeof createPanelInteractions> | null>(null);
  const positions = layoutBoxes(layout);
  const viewing = useWorkspacePanelLocation(location, project, canvas, [...positions.panels.keys()]);
  const { selected: focused, maximized } = viewing;
  const persist = (next: Layout) => { void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  useLayoutEffect(() => {
    const context: PanelInteractionContext = { projectId: project.id, layout: project.layout, language,
      panels: project.panels.map(({ id, agent, run }) => ({ id, agent, runId: run?.id })),
      visible, maximizedPanelId: maximized, presentLayout: setLayout, commitLayout: persist };
    if (interactions.current) interactions.current.update(context);
    else interactions.current = createPanelInteractions(canvas.current!, context);
  });
  useLayoutEffect(() => () => { interactions.current?.dispose(); interactions.current = null; }, []);
  const close = (panelId: string) => { void window.workbench.closePanel(project.id, panelId).catch(error => report(error.message)); };
  useImperativeHandle(ref, () => ({ shortcut(action) {
    if (adding) return false;
    if (action === 'addPanel' && project.panels.length < 10) { setAdding(true); return true; }
    if (!focused) return false;
    if (action === 'closePanel') { close(maximized ?? focused); return true; }
    if (action === 'maximizePanel') { viewing.toggleMaximize(focused); return true; }
    if (action === 'nextPanel' || action === 'previousPanel') {
      viewing.move(action === 'nextPanel' ? 1 : -1); return true;
    }
    return false;
  } }));
  const directoryEnd = project.directory.lastIndexOf('/');
  return <div className="workspace"><header className="workspace-toolbar"><strong title={project.name}>{project.name}</strong><span className="project-path" title={project.directory}><span className="path-parent">{project.directory.slice(0, directoryEnd)}</span><span className="path-leaf">{project.directory.slice(directoryEnd)}</span></span><span className="muted">{t('panelCount', { count: project.panels.length })}</span><button aria-label={t('addPanel')} disabled={project.panels.length >= 10} onClick={() => setAdding(true)}>＋</button></header>
    <div className="canvas" ref={canvas}>
      {!project.panels.length && <div className="empty"><p>{t('emptyProject')}</p><button onClick={() => setAdding(true)}>＋ {t('addPanel')}</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        const { run } = panel;
        const title = run?.title ?? t('untitled');
        const position: CSSProperties = maximized === panel.id ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return <section key={panel.id} data-panel-id={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused === panel.id ? 'focused' : ''}`}
          onMouseDown={event => { if (!(event.target as HTMLElement).closest('.panel-header')) viewing.select(panel.id); }} onFocusCapture={() => viewing.focusChanged(panel.id)}>
          <header className="panel-header" onPointerDown={event => interactions.current?.startSwap(event.nativeEvent, event.currentTarget, panel.id)} onClick={() => viewing.focus(panel.id)}>
            <span className="agent-title" title={title}><span className="agent-symbols"><ProcessingStatusIcon state={panel.status} focusable /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span><span className="session-title">{title}</span></span><span className="panel-actions">
              <button aria-label={maximized === panel.id ? t('restorePanel') : t('enlargePanel')} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); viewing.toggleMaximize(panel.id); }}>⤢</button>
              <button aria-label={t('closePanel')} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); close(panel.id); }}>×</button>
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
      added={() => { setAdding(false); viewing.panelAdded(); }} openAgentSettings={openAgentSettings} />}
  </div>;
}
