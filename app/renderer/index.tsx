import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {} from '../shared/api';
import { newDraft, navigationWidth, type Snapshot } from '../shared/model';
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
  const [draft, setDraft] = useState(newDraft);
  const [setup, setSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsPage = useRef<SettingsPageActions>(null);
  const leavingSettings = useRef(false);
  const workspace = useRef<WorkspaceActions>(null);
  const collapsed = state ? !state.navigation.visible : false;
  const [dragWidth, setDragWidth] = useState<number>();
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelResize.current?.(), []);
  const [selectedPanels, setSelectedPanels] = useState<Record<string, string>>({});
  const { notices, report, dismiss } = useNotices();
  useEffect(() => {
    let unsubscribe = () => {};
    void window.workbench.snapshot().then(async snapshot => {
      const dark = snapshot.resolvedTheme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      configureTerminals(dark, report);
      setState(snapshot); setSetup(!snapshot.projects.length);
      snapshot.errors.forEach(message => report(message));
      reconcileTerminals(snapshot.runs);
      unsubscribe = window.workbench.subscribe(event => {
        if (event.kind === 'snapshot') { reconcileTerminals(event.snapshot.runs); setState(event.snapshot); }
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
  const navigate = (action: () => void) => { if (settingsOpen) void leaveSettings(action); else action(); };
  const toggleSettings = () => { if (settingsOpen) void leaveSettings(); else setSettingsOpen(true); };
  const activate = (id: string) => navigate(() => { setSetup(false); void window.workbench.activateProject(id).catch(error => report(error.message)); });
  const create = () => navigate(() => setSetup(true));
  function resizeNavigation(event: PointerEvent<HTMLDivElement>) {
    if (!state || event.button !== 0) return;
    event.preventDefault(); cancelResize.current?.();
    const element = event.currentTarget, start = event.clientX;
    const width = element.parentElement!.getBoundingClientRect().width;
    let next = width;
    element.setPointerCapture(event.pointerId);
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      next = navigationWidth(width + pointer.clientX - start); setDragWidth(next);
    };
    const finish = (commit: boolean) => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel); element.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel); cancelResize.current = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      if (commit) void window.workbench.saveNavigation({ ...state.navigation, width: next }).catch(error => report(error.message)).finally(() => setDragWidth(undefined));
      else setDragWidth(undefined);
    };
    const up = (pointer: globalThis.PointerEvent) => { if (pointer.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    cancelResize.current = cancel;
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel); element.addEventListener('lostpointercapture', cancel);
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
        {state?.projects.map(project => <ProjectNavigationItem key={project.id} project={project} runs={state.runs} openProject={activate}><button title={`${project.name} · ${project.panels.length} 个面板`} aria-label={project.name} aria-current={!settingsOpen && !setup && active?.id === project.id ? 'page' : undefined} className={`project-link ${!settingsOpen && !setup && active?.id === project.id ? 'selected' : ''}`} onClick={() => activate(project.id)}><span className="project-initial" aria-hidden="true">{projectInitial(project.name)}</span><span className="project-name">{project.name}</span><small>{project.panels.length}</small></button></ProjectNavigationItem>)}
        <button className={`add-project ${!settingsOpen && setup ? 'selected' : ''}`} aria-label="添加项目" aria-current={!settingsOpen && setup ? 'page' : undefined} onClick={create}><span>＋</span>添加项目</button>
      </div>
      <div className="nav-footer"><span>本地 Agent 工作台</span><button className={`settings-entry ${settingsOpen ? 'selected' : ''}`} aria-label="全局设置" aria-current={settingsOpen ? 'page' : undefined} disabled={!state} onClick={toggleSettings}>⚙</button></div>
      <div className="navigation-resize" role="separator" aria-label="调整项目导航宽度" aria-orientation="vertical" onPointerDown={resizeNavigation} />
    </nav><main>
      <div className="workbench-page" hidden={settingsOpen} inert={settingsOpen}>
        {!state ? <div className="empty">正在打开工作台…</div> : setup ? <Setup defaultLayout={state.settings.defaultLayout} draft={draft} change={setDraft} cancel={() => setSetup(false)} created={id => { setDraft(newDraft()); activate(id); }} openProject={activate} report={report} /> : active ? <Workspace ref={workspace} visible={!settingsOpen} key={active.id} project={active} runs={state.runs} report={report} selectedPanelId={selectedPanels[active.id]} selectPanel={panelId => setSelectedPanels(previous => previous[active.id] === panelId ? previous : { ...previous, [active.id]: panelId })} /> : <div className="empty"><p>让你的 Agent 在同一个工作台中并行工作</p><button className="primary" onClick={create}>创建项目</button></div>}
      </div>
      {state && settingsOpen && <SettingsPage ref={settingsPage} settings={state.settings} startupTheme={state.startupTheme} report={report} back={() => void leaveSettings()} />}
    </main></div>
    <Notices notices={notices} dismiss={dismiss} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
