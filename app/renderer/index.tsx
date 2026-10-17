import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {} from '../shared/api';
import { newDraft, type Snapshot } from '../shared/model';
import { useProjectNavigation } from './ProjectNavigation';
import { Setup } from './Setup';
import { Workspace, type WorkspaceActions } from './Workspace';
import { usePanelLocation } from './panel-location';
import { Notices, useNotices } from './Notices';
import { SettingsPage, type SettingsPageActions } from './SettingsPage';
import { shortcutActions, shortcutFromEvent } from '../shared/shortcuts';
import type { SettingsCategory } from '../shared/settings';
import { configureTerminals, reconcileTerminals, terminalEvent } from './terminals';
import '@xterm/xterm/css/xterm.css';
import './style.css';

function App() {
  const [state, setState] = useState<Snapshot>();
  const [draft, setDraft] = useState(newDraft);
  const [setup, setSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialSettingsCategory, setInitialSettingsCategory] = useState<SettingsCategory>();
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const settingsPage = useRef<SettingsPageActions>(null);
  const leavingSettings = useRef(false);
  const workspace = useRef<WorkspaceActions>(null);
  const { notices, report, dismiss } = useNotices();
  const location = usePanelLocation({ snapshot: state, visible: !settingsOpen && !setup,
    activateProject: id => window.workbench.activateProject(id), showWorkbench: () => setSetup(false), report });
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
  const navigate = (action: () => void) => {
    if (settingsOpen) void leaveSettings(action); else action();
  };
  const openSettings = (category?: SettingsCategory) => {
    if (settingsOpen) { if (category) settingsPage.current?.showCategory(category); }
    else location.leaveWorkbench(() => { setInitialSettingsCategory(category); setSettingsOpen(true); });
  };
  const toggleSettings = () => { if (settingsOpen) void leaveSettings(); else openSettings(); };
  const activate = (id: string) => navigate(() => location.openProject(id));
  const create = () => navigate(() => location.leaveWorkbench(() => setSetup(true)));
  const locatePanel = (projectId: string, panelId: string) => navigate(() => location.locatePanel(projectId, panelId));
  const navigation = useProjectNavigation({ snapshot: state, page: settingsOpen ? 'settings' : setup ? 'setup' : 'workbench',
    view: location.view, openProject: activate, locatePanel, createProject: create, toggleSettings, report });
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
  return <div className="app">
    <header className="system-bar"><div className="system-brand">{navigation.toggle}<span className="wordmark">VibeBridge</span></div></header>
    {state?.settingsMigrationConflict && !migrationDismissed && <aside className="settings-migration-notice" role="status" aria-label="快捷键迁移提醒">
      <span>新增的默认快捷键与已有绑定冲突。可稍后处理，保存设置前需修正冲突。</span>
      <button onClick={() => openSettings('shortcuts')}>打开快捷键设置</button>
      <button aria-label="关闭快捷键迁移提醒" onClick={() => setMigrationDismissed(true)}>稍后处理</button>
    </aside>}
    <div className="app-body">{navigation.sidebar}<main>
      <div className={`workbench-page ${location.locating ? 'locating-panel' : ''}`} hidden={settingsOpen} inert={settingsOpen}>
        {!state ? <div className="empty">正在打开工作台…</div> : setup ? <Setup defaultLayout={state.settings.defaultLayout} draft={draft} change={setDraft} cancel={() => setSetup(false)} created={id => { setDraft(newDraft()); activate(id); }} openProject={activate} report={report} /> : active ? <Workspace ref={workspace} visible={!settingsOpen} key={active.id} project={active} runs={state.runs} report={report} location={location} /> : <div className="empty"><p>让你的 Agent 在同一个工作台中并行工作</p><button className="primary" onClick={create}>创建项目</button></div>}
      </div>
      {state && settingsOpen && <SettingsPage ref={settingsPage} settings={state.settings} startupTheme={state.startupTheme} initialCategory={initialSettingsCategory} report={report} back={() => void leaveSettings()} />}
    </main></div>
    <Notices notices={notices} dismiss={dismiss} />
  </div>;
}
createRoot(document.getElementById('root')!).render(<App />);
