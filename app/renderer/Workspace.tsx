import { useLocalization } from './Localization';
import { agentIcons } from './agent-icons';
import { useLayoutEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type Ref, type PointerEvent } from 'react';
import { panelLimitReached, projectPanels, type Layout, type PanelView, type ProjectView, type Run } from '../shared/model';
import { layoutBoxes } from '../shared/layout';
import { mountTerminal } from './terminals';
import { AgentPicker } from './AgentPicker';
import { createPanelInteractions, type PanelInteractionContext } from './panel-interactions';
import type { ShortcutAction } from '../shared/shortcuts';
import { useWorkspacePanelLocation, type PanelLocation } from './panel-location';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';
import { PanelTray } from './PanelTray';
import { ProjectSummary } from './ProjectSummary';

export interface WorkspaceActions { shortcut(action: ShortcutAction): boolean }

function TerminalView({ run }: { run?: Run }) {
  const { t } = useLocalization();
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (run?.state === 'running' && container.current) return mountTerminal(run.id, container.current);
  }, [run?.id, run?.state]);
  return <div className="terminal-container" ref={container}>{run?.state === 'starting' ? <div className="terminal-message">{t('launchPending')}</div> : run?.state === 'failed' ? <div className="terminal-message">{t('launchFailed')}</div> : run?.state === 'stopped' ? <div className="terminal-message">{t('runStopped')}</div> : !run ? <div className="terminal-message muted">{t('starting')}</div> : null}</div>;
}

const maximizedPosition: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 };

/** One Agent panel: header with title, processing state, Agent type and actions, over its terminal. */
function AgentPanel({ panel, position, focused, actions, select, focusChanged, headerPointerDown, headerClick }: {
  panel: PanelView; position: CSSProperties; focused: boolean; actions: ReactNode;
  select(): void; focusChanged(): void; headerPointerDown?(event: PointerEvent<HTMLElement>): void; headerClick(): void;
}) {
  const { t } = useLocalization();
  const title = panel.run?.title ?? t('untitled');
  return <section data-panel-id={panel.id} className={`panel-slot ${panel.agent}`} style={position}><div className={`agent-panel ${focused ? 'focused' : ''}`}
    onMouseDown={event => { if (!(event.target as HTMLElement).closest('.panel-header')) select(); }} onFocusCapture={focusChanged}>
    <header className="panel-header" onPointerDown={headerPointerDown} onClick={headerClick}>
      <span className="agent-title" data-hint={title}><span className="agent-symbols"><ProcessingStatusIcon state={panel.status} focusable /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span><span className="session-title">{title}</span></span>
      <span className="panel-actions">{actions}</span>
    </header><TerminalView run={panel.run} />
  </div></section>;
}

function PanelAction({ label, run, children }: { label: string; run(): void; children: ReactNode }) {
  return <button aria-label={label} draggable={false} onMouseDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); run(); }}>{children}</button>;
}

export function Workspace({ project, report, openAgentSettings, location, visible, ref }: { project: ProjectView; report(message: string): void; openAgentSettings(): void; location: PanelLocation; visible: boolean; ref: Ref<WorkspaceActions> }) {
  const { t, language } = useLocalization();
  const [layout, setLayout] = useState(project.layout);
  const [adding, setAdding] = useState(false);
  const canvas = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLElement>(null);
  const interactions = useRef<ReturnType<typeof createPanelInteractions> | null>(null);
  const positions = layoutBoxes(layout);
  const viewing = useWorkspacePanelLocation(location, project, canvas, [...positions.panels.keys()]);
  const { selected: focused, maximized } = viewing;
  const openTrayPanel = project.tray.find(panel => panel.id === maximized);
  const full = panelLimitReached(project);
  const persist = (next: Layout) => { void window.workbench.saveLayout(project.id, next).catch(error => report(error.message)); };
  const placeInLayout = (panelId: string, next: Layout) => {
    // The layout area returns to the resident layout, where the placed panel lives; a rejected placement changes nothing.
    const open = openTrayPanel?.id;
    viewing.collapse();
    void window.workbench.placeInLayout(project.id, panelId, next).catch(error => {
      if (open) viewing.reopen(open);
      report(error.message);
    });
  };
  const moveToTray = (panelId: string) => {
    // A panel moved to the tray waits there collapsed, so a maximized resident panel is restored first.
    if (maximized === panelId) viewing.toggleMaximize(panelId);
    void window.workbench.moveToTray(project.id, panelId).catch(error => report(error.message));
  };
  useLayoutEffect(() => {
    const context: PanelInteractionContext = { projectId: project.id, layout: project.layout, language,
      panels: project.panels.map(({ id, agent, run }) => ({ id, agent, runId: run?.id })),
      tray: project.tray.map(({ id, agent }) => ({ id, agent })), trayElement: tray.current,
      visible, maximizedPanelId: maximized, presentLayout: setLayout, commitLayout: persist, placeInLayout, moveToTray };
    if (interactions.current) interactions.current.update(context);
    else interactions.current = createPanelInteractions(canvas.current!, context);
  });
  useLayoutEffect(() => () => { interactions.current?.dispose(); interactions.current = null; }, []);
  // Saved layouts are observed as they are delivered, independently of React's batching of App snapshots.
  useLayoutEffect(() => window.workbench.subscribe(event => {
    const saved = event.kind === 'snapshot' && event.snapshot.projects.find(item => item.id === project.id);
    if (saved) interactions.current?.layoutSaved(saved.layout);
  }), [project.id]);
  const close = (panelId: string) => { void window.workbench.closePanel(project.id, panelId).catch(error => report(error.message)); };
  // Resident and open tray panels differ only in where they sit and in their first action.
  const agentPanel = (panel: PanelView, position: CSSProperties, isFocused: boolean, action: ReactNode) =>
    <AgentPanel key={panel.id} panel={panel} position={position} focused={isFocused}
      select={() => viewing.select(panel.id)} focusChanged={() => viewing.focusChanged(panel.id)} headerClick={() => viewing.focus(panel.id)}
      headerPointerDown={event => interactions.current?.startDrag(event.nativeEvent, event.currentTarget, panel.id)}
      actions={<>{action}<PanelAction label={t('closePanel')} run={() => close(panel.id)}>×</PanelAction></>} />;
  useImperativeHandle(ref, () => ({ shortcut(action) {
    if (adding) return false;
    if (action === 'addPanel' && !full) { setAdding(true); return true; }
    if (action === 'closePanel' && (maximized ?? focused)) { close((maximized ?? focused)!); return true; }
    // Panel keys follow the resident layout: an open tray panel returns to the tray first.
    if (action === 'maximizePanel') {
      if (openTrayPanel) viewing.collapse();
      else if (focused) viewing.toggleMaximize(focused);
      return !!(openTrayPanel || focused);
    }
    if (action === 'nextPanel' || action === 'previousPanel') {
      if (openTrayPanel) viewing.collapse();
      if (focused) viewing.move(action === 'nextPanel' ? 1 : -1);
      return !!(openTrayPanel || focused);
    }
    return false;
  } }));
  return <div className="workspace"><header className="workspace-toolbar">
    {visible && <ProjectSummary panels={projectPanels(project)}
      locate={panel => location.locatePanel(project.id, panel.id, panel.run?.id)} />}
    <button aria-label={t('addPanel')} disabled={full} onClick={() => setAdding(true)}>＋</button>
  </header>
    <div className="canvas" ref={canvas}>
      {!project.panels.length && !openTrayPanel && <div className="empty"><p>{t('emptyProject')}</p><button disabled={full} onClick={() => setAdding(true)}>＋ {t('addPanel')}</button></div>}
      {project.panels.map(panel => {
        const box = positions.panels.get(panel.id);
        if (!box) return null;
        // Hidden panels stay mounted, so their terminals keep their screens.
        const position: CSSProperties = maximized === panel.id ? maximizedPosition
          : { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%`, visibility: maximized ? 'hidden' : 'visible' };
        return agentPanel(panel, position, focused === panel.id, <>
          <PanelAction label={t('moveToTray')} run={() => moveToTray(panel.id)}>⇣</PanelAction>
          <PanelAction label={maximized === panel.id ? t('restorePanel') : t('enlargePanel')} run={() => viewing.toggleMaximize(panel.id)}>⤢</PanelAction>
        </>);
      })}
      {openTrayPanel && agentPanel(openTrayPanel, maximizedPosition, true,
        <PanelAction label={t('collapsePanel')} run={viewing.collapse}>⌄</PanelAction>)}
      {!maximized && positions.dividers.map(divider => {
        const { box, axis, ratio } = divider;
        const style: CSSProperties = axis === 'row'
          ? { left: `calc(${(box.x + box.width * ratio) * 100}% - 4px)`, top: `${box.y * 100}%`, width: 8, height: `${box.height * 100}%`, cursor: 'col-resize' }
          : { left: `${box.x * 100}%`, top: `calc(${(box.y + box.height * ratio) * 100}% - 4px)`, height: 8, width: `${box.width * 100}%`, cursor: 'row-resize' };
        return <div key={divider.path.join('.')} role="separator" aria-orientation={axis === 'row' ? 'vertical' : 'horizontal'} className="divider" style={style} onPointerDown={event => interactions.current?.startResize(event.nativeEvent, event.currentTarget, divider)} />;
      })}
    </div>
    <PanelTray ref={tray} panels={project.tray} openPanelId={openTrayPanel?.id} open={viewing.openTrayPanel} collapse={viewing.collapse}
      cardPointerDown={(event, panelId) => interactions.current?.startDrag(event.nativeEvent, event.currentTarget, panelId)} />
    {adding && <AgentPicker projectId={project.id} full={full} close={() => setAdding(false)}
      added={panelId => { setAdding(false); viewing.panelAdded(panelId); }} openAgentSettings={openAgentSettings} />}
  </div>;
}
