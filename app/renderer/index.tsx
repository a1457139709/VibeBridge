import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {} from '../shared/api';
import { newDraft, type Snapshot } from '../shared/model';
import { Setup } from './Setup';
import { Workspace, type WorkspaceActions } from './Workspace';
import { SettingsPage } from './SettingsPage';
import { shortcutActions, shortcutFromEvent } from '../shared/shortcuts';
import { configureTerminals, reconcileTerminals, terminalEvent } from './terminals';
import '@xterm/xterm/css/xterm.css';
import './style.css';

function App() {
  const [state, setState] = useState<Snapshot>();
  const [draft, setDraft] = useState(newDraft);
  const [named, setNamed] = useState(false);
  const [setup, setSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspace = useRef<WorkspaceActions>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [selectedPanels, setSelectedPanels] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let unsubscribe = () => {};
    void window.workbench.snapshot().then(async snapshot => {
      const dark = snapshot.resolvedTheme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      configureTerminals(dark, setError);
      setState(snapshot); setSetup(!snapshot.projects.length);
      if (snapshot.errors.length) setError(snapshot.errors.join('\n'));
      reconcileTerminals(snapshot.runs);
      unsubscribe = window.workbench.subscribe(event => {
        if (event.kind === 'snapshot') { reconcileTerminals(event.snapshot.runs); setState(event.snapshot); }
        else if (event.kind === 'error') setError(event.message);
        terminalEvent(event);
      });
      await window.workbench.ready();
    }).catch(error => setError(error.message));
    return () => unsubscribe();
  }, []);
  const activate = (id: string) => { setSetup(false); void window.workbench.activateProject(id).catch(error => setError(error.message)); };
  const active = state?.projects.find(project => project.id === state.activeProjectId);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!state || !document.hasFocus() || (event.target as HTMLElement).closest('[data-shortcut-recorder]') || document.querySelector('dialog[open]')) return;
      const binding = shortcutFromEvent(event);
      const action = shortcutActions.find(action => state.settings.shortcuts[action] === binding);
      if (!action) return;
      let handled = false;
      if (action === 'settings') { setSettingsOpen(true); handled = true; }
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
  return <div className={`app ${collapsed ? 'navigation-collapsed' : ''}`}><header className="system-bar"><div className="system-brand"><span className="wordmark">VibeBridge</span><button aria-label={collapsed ? '展开项目导航' : '折叠项目导航'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>☷</button></div><button className="settings-entry" aria-label="全局设置" disabled={!state} onClick={() => setSettingsOpen(true)}>⚙</button></header>
    {state && settingsOpen && <SettingsPage settings={state.settings} startupTheme={state.startupTheme} back={() => setSettingsOpen(false)} />}
    <div className="app-body" hidden={settingsOpen} inert={settingsOpen}><nav className={`navigation ${collapsed ? 'collapsed' : ''}`} aria-label="项目导航"><div className="nav-heading">{collapsed ? '项目' : '工作项目'}</div>
      {state?.projects.map(project => <button key={project.id} title={`${project.name} · ${project.panels.length} 个面板`} aria-label={project.name} aria-current={!setup && active?.id === project.id ? 'page' : undefined} className={`project-link ${!setup && active?.id === project.id ? 'selected' : ''}`} onClick={() => activate(project.id)}><span className="project-initial" aria-hidden="true">{project.name.slice(0, 1).toUpperCase()}</span>{!collapsed && <><span className="project-name">{project.name}</span><small>{project.panels.length}</small></>}</button>)}
      <button className={`add-project ${setup ? 'selected' : ''}`} aria-label="添加项目" onClick={() => setSetup(true)}><span>＋</span>{!collapsed && '添加项目'}</button><div className="nav-footer">{collapsed ? 'VB' : '本地 Agent 工作台'}</div>
    </nav><main>{!state ? <div className="empty">正在打开工作台…</div> : setup ? <Setup defaultLayout={state.settings.defaultLayout} draft={draft} change={setDraft} named={named} setNamed={setNamed} cancel={() => setSetup(false)} created={activate} report={setError} /> : active ? <Workspace ref={workspace} visible={!settingsOpen} key={active.id} project={active} runs={state.runs} report={setError} selectedPanelId={selectedPanels[active.id]} selectPanel={panelId => setSelectedPanels(previous => previous[active.id] === panelId ? previous : { ...previous, [active.id]: panelId })} /> : <div className="empty"><p>让你的 Agent 在同一个工作台中并行工作</p><button className="primary" onClick={() => setSetup(true)}>创建项目</button></div>}</main></div>
    {error && <div className="error-banner" role="alert"><span>{error.replace(/^Error invoking remote method '[^']+': Error: /, '')}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
