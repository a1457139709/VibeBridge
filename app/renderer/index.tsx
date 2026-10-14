import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {} from '../shared/api';
import { newDraft, navigationWidth, type Snapshot } from '../shared/model';
import { capturePointer } from './pointer-capture';
import { sessionTitle } from '../shared/session-title';
import { agentIcons } from './agent-icons';
import { ProjectNavigationItem } from './ProjectManagement';
import { Setup } from './Setup';
import { Workspace, type WorkspaceActions } from './Workspace';
import { Notices, useNotices } from './Notices';
import { SettingsPage, type SettingsPageActions } from './SettingsPage';
import { shortcutActions, shortcutFromEvent } from '../shared/shortcuts';
import { configureTerminals, reconcileTerminals, terminalEvent } from './terminals';
import '@xterm/xterm/css/xterm.css';
import './style.css';

const nameSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const projectInitial = (name: string) => nameSegments.segment(name)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? '';

function App() {
  const [state, setState] = useState<Snapshot>();
  const currentRuns = useRef<Snapshot['runs']>([]);
  const [draft, setDraft] = useState(newDraft);
  const [setup, setSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPage = useRef<SettingsPageActions>(null);
  const leavingSettings = useRef(false);
  const workspace = useRef<WorkspaceActions>(null);
  const workbenchPage = useRef<HTMLDivElement>(null);
  const navigationVersion = useRef(0);
  const panelAnimation = useRef<Animation | undefined>(undefined);
  const [switchingPanels, setSwitchingPanels] = useState(false);
  const collapsed = state ? !state.navigation.visible : false;
  const [dragWidth, setDragWidth] = useState<number>();
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelResize.current?.(), []);
  const [selectedPanels, setSelectedPanels] = useState<Record<string, string>>({});
  const [maximizedPanels, setMaximizedPanels] = useState<Record<string, string | undefined>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [focusRequests, setFocusRequests] = useState<Record<string, number>>({});
  useEffect(() => {
    const id = state?.activeProjectId;
    if (id) setExpandedProjects(previous => previous[id] === undefined ? { ...previous, [id]: true } : previous);
  }, [state?.activeProjectId]);
  const { notices, report, dismiss } = useNotices();
  useEffect(() => {
    let unsubscribe = () => {};
    void window.workbench.snapshot().then(async snapshot => {
      const dark = snapshot.resolvedTheme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      configureTerminals(dark, report);
      currentRuns.current = snapshot.runs;
      setState(snapshot); setSetup(!snapshot.projects.length);
      snapshot.errors.forEach(message => report(message));
      reconcileTerminals(snapshot.runs);
      unsubscribe = window.workbench.subscribe(event => {
        if (event.kind === 'snapshot') { currentRuns.current = event.snapshot.runs; reconcileTerminals(event.snapshot.runs); setState(event.snapshot); }
        else if (event.kind === 'error') report(event.message);
        terminalEvent(event);
      });
      await window.workbench.ready();
    }).catch(error => report(error.message));
    return () => unsubscribe();
  }, []);
  async function leaveSettings(action: () => void = () => {}) {
    if (leavingSettings.current) return;
    leavingSettings.current = true;
    try {
      if (await settingsPage.current?.requestLeave() ?? true) { setSettingsOpen(false); action(); }
    } catch (error) { report((error as Error).message); }
    finally { leavingSettings.current = false; }
  }
  function beginNavigation(action: () => void) {
    navigationVersion.current += 1;
    panelAnimation.current?.cancel();
    setSwitchingPanels(false);
    action();
  }
  const navigate = (action: () => void) => {
    const proceed = () => beginNavigation(action);
    if (settingsOpen) void leaveSettings(proceed); else proceed();
  };
  const toggleSettings = () => { if (settingsOpen) void leaveSettings(); else beginNavigation(() => setSettingsOpen(true)); };
  const activate = (id: string) => navigate(() => { setSetup(false); void window.workbench.activateProject(id).catch(error => report(error.message)); });
  const create = () => navigate(() => setSetup(true));
  const locatePanel = (projectId: string, panelId: string) => navigate(() => {
    void switchPanel(projectId, panelId).catch(error => report(error.message));
  });
  async function switchPanel(projectId: string, panelId: string) {
    const target = state?.projects.find(project => project.id === projectId)?.panels.find(panel => panel.id === panelId);
    if (!state || !target) return;
    const revision = navigationVersion.current;
    const source = state.projects.find(project => project.id === state.activeProjectId);
    const sourceMaximized = source?.panels.some(panel => panel.id === maximizedPanels[source.id]);
    const changingMaximized = sourceMaximized && (source?.id !== projectId || maximizedPanels[projectId] !== panelId);
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animated = !!changingMaximized && !reducedMotion;
    async function animate(entering: boolean) {
      const element = workbenchPage.current?.querySelector('.canvas');
      if (!element?.animate) return false;
      try {
        const frames = [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.96)', opacity: .3 }];
        const animation = element.animate(entering ? frames.reverse() : frames, { duration: 100, easing: 'ease-in-out', fill: 'both' });
        panelAnimation.current = animation;
        await animation.finished;
        animation.cancel();
        if (panelAnimation.current === animation) panelAnimation.current = undefined;
        return true;
      } catch { return false; }
    }
    setSwitchingPanels(true);
    try {
      if (animated) animated = await animate(false);
      if (revision !== navigationVersion.current) return;
      setSetup(false);
      setMaximizedPanels(previous => ({ ...previous, [projectId]: sourceMaximized ? panelId : undefined }));
      setSelectedPanels(previous => ({ ...previous, [projectId]: panelId }));
      setFocusRequests(previous => ({ ...previous, [projectId]: (previous[projectId] ?? 0) + 1 }));
      await window.workbench.activateProject(projectId);
      // Let the selected project's DOM and terminal mount before the incoming half.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (revision !== navigationVersion.current) return;
      if (animated) animated = await animate(true);
      if (revision === navigationVersion.current && changingMaximized && !animated) {
        report(`已切换至：${sessionTitle(target.agent, currentRuns.current.find(run => run.panelId === panelId)?.rawTitle)}`, 'success');
      }
    } finally {
      if (revision === navigationVersion.current) setSwitchingPanels(false);
    }
  }
  function resizeNavigation(event: PointerEvent<HTMLDivElement>) {
    if (!state || event.button !== 0) return;
    event.preventDefault(); cancelResize.current?.();
    const element = event.currentTarget, start = event.clientX;
    const width = element.parentElement!.getBoundingClientRect().width;
    let next = width;
    const move = (pointer: globalThis.PointerEvent) => {
      next = navigationWidth(width + pointer.clientX - start); setDragWidth(next);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel); cancelResize.current = undefined;
      if (commit) void window.workbench.saveNavigation({ ...state.navigation, width: next }).catch(error => report(error.message)).finally(() => setDragWidth(undefined));
      else setDragWidth(undefined);
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }
  const active = state?.projects.find(project => project.id === state.activeProjectId);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!state || !document.hasFocus() || (event.target as HTMLElement).closest('[data-shortcut-recorder]') || document.querySelector('dialog[open]')) return;
      const binding = shortcutFromEvent(event);
      const action = shortcutActions.find(action => state.settings.shortcuts[action] === binding);
      if (!action) return;
      let handled = false;
      if (action === 'settings') { toggleSettings(); handled = true; }
      else if (!settingsOpen && (action === 'nextProject' || action === 'previousProject') && state.projects.length) {
        const index = state.projects.findIndex(project => project.id === state.activeProjectId);
        const next = (index + (action === 'nextProject' ? 1 : -1) + state.projects.length) % state.projects.length;
        activate(state.projects[next].id); handled = true;
      } else if (!settingsOpen && !setup) handled = workspace.current?.shortcut(action) ?? false;
      if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  }, [state, setup, settingsOpen]);
  return <div className={`app ${collapsed ? 'navigation-collapsed' : ''}`} style={{ '--navigation-width': `${dragWidth ?? state?.navigation.width ?? 212}px` } as CSSProperties}>
    <header className="system-bar"><div className="system-brand"><button aria-label={collapsed ? '展开项目导航' : '折叠项目导航'} aria-expanded={!collapsed} disabled={!state} onClick={() => {
      if (state) void window.workbench.saveNavigation({ ...state.navigation, visible: collapsed }).catch(error => report(error.message));
    }}>☷</button><span className="wordmark">VibeBridge</span></div></header>
    <div className="app-body"><nav className={`navigation ${collapsed ? 'collapsed' : ''}`} aria-label="项目导航">
      <div className="navigation-projects"><div className="nav-heading">工作项目</div>
        {state?.projects.map(project => {
          const expanded = expandedProjects[project.id] ?? active?.id === project.id;
          const selected = project.panels.some(panel => panel.id === selectedPanels[project.id]) ? selectedPanels[project.id] : project.panels[0]?.id;
          return <section key={project.id} className="project-group" data-project-id={project.id}>
            <ProjectNavigationItem project={project} runs={state.runs} openProject={activate}>
              <button className="project-disclosure" aria-label={`${expanded ? '收起' : '展开'}项目面板：${project.name}`} aria-expanded={expanded} onClick={() => setExpandedProjects(previous => ({ ...previous, [project.id]: !expanded }))}>{expanded ? '⌄' : '›'}</button>
              <button title={`${project.name} · ${project.panels.length} 个面板`} aria-label={project.name} aria-current={!settingsOpen && !setup && active?.id === project.id ? 'page' : undefined} className={`project-link ${!settingsOpen && !setup && active?.id === project.id ? 'selected' : ''}`} onClick={() => activate(project.id)}><span className="project-initial" aria-hidden="true">{projectInitial(project.name)}</span><span className="project-name">{project.name}</span><small>{project.panels.length}</small></button>
            </ProjectNavigationItem>
            {expanded && !!project.panels.length && <div className="project-panels" aria-label={`${project.name}的面板`}>{project.panels.map(panel => {
              const title = sessionTitle(panel.agent, state.runs.find(run => run.panelId === panel.id)?.rawTitle);
              const current = !settingsOpen && !setup && active?.id === project.id && selected === panel.id;
              return <button key={panel.id} data-locate-panel-id={panel.id} title={title} aria-current={current ? 'true' : undefined} className={`panel-link ${panel.agent} ${current ? 'selected' : ''}`} onClick={() => locatePanel(project.id, panel.id)}><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span><span className="session-title">{title}</span></button>;
            })}</div>}
          </section>;
        })}
        <button className={`add-project ${!settingsOpen && setup ? 'selected' : ''}`} aria-label="添加项目" aria-current={!settingsOpen && setup ? 'page' : undefined} onClick={create}><span>＋</span>添加项目</button>
      </div>
      <div className="nav-footer"><span>本地 Agent 工作台</span><button className={`settings-entry ${settingsOpen ? 'selected' : ''}`} aria-label="全局设置" aria-current={settingsOpen ? 'page' : undefined} disabled={!state} onClick={toggleSettings}>⚙</button></div>
      <div className="navigation-resize" role="separator" aria-label="调整项目导航宽度" aria-orientation="vertical" onPointerDown={resizeNavigation} />
    </nav><main>
      <div ref={workbenchPage} className={`workbench-page ${switchingPanels ? 'locating-panel' : ''}`} hidden={settingsOpen} inert={settingsOpen}>
        {!state ? <div className="empty">正在打开工作台…</div> : setup ? <Setup defaultLayout={state.settings.defaultLayout} draft={draft} change={setDraft} cancel={() => setSetup(false)} created={id => { setDraft(newDraft()); activate(id); }} openProject={activate} report={report} /> : active ? <Workspace ref={workspace} visible={!settingsOpen} key={active.id} project={active} runs={state.runs} report={report} maximizedPanelId={maximizedPanels[active.id]} maximizePanel={panelId => setMaximizedPanels(previous => previous[active.id] === panelId ? previous : { ...previous, [active.id]: panelId })} locatePanel={panelId => locatePanel(active.id, panelId)} focusRequest={focusRequests[active.id]} selectedPanelId={selectedPanels[active.id]} selectPanel={panelId => setSelectedPanels(previous => previous[active.id] === panelId ? previous : { ...previous, [active.id]: panelId })} /> : <div className="empty"><p>让你的 Agent 在同一个工作台中并行工作</p><button className="primary" onClick={create}>创建项目</button></div>}
      </div>
      {state && settingsOpen && <SettingsPage ref={settingsPage} settings={state.settings} startupTheme={state.startupTheme} report={report} back={() => void leaveSettings()} />}
    </main></div>
    <Notices notices={notices} dismiss={dismiss} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
