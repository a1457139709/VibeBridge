import { HoverHints } from './common/HoverHints';
import { Localization, useLocalization } from './common/Localization';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import type {} from '../shared/api';
import { newDraft, type Snapshot } from '../shared/model';
import { useProjectNavigation } from './projects/ProjectNavigation';
import { useForgeSidebar } from './forge/ForgeSidebar';
import { fitRegions, useWindowWidth, type Region, type RegionFit, type WidestOnResize } from './common/region-widths';
import { Setup } from './projects/Setup';
import { Workspace, type WorkspaceActions } from './workspace/Workspace';
import { usePanelLocation } from './panels/panel-location';
import { Notices, useNotices } from './common/Notices';
import { SettingsPage, type SettingsPageActions } from './settings/SettingsPage';
import { SettingsConflictDialog } from './settings/SettingsConflict';
import { shortcutActions, shortcutFromEvent } from '../shared/settings/shortcuts';
import type { SettingsCategory } from '../shared/settings/settings';
import { configureTerminals, reconcileTerminals, terminalEvent, setTerminalLanguage } from './panels/terminals';

/** The application shell: system bar, project navigation, and the current page. */
export function App() {
  const [state, setState] = useState<Snapshot>();
  useEffect(() => {
    const language = state?.settings.language ?? 'en';
    document.documentElement.lang = language;
    setTerminalLanguage(language);
  }, [state?.settings.language]);
  return (
    <Localization language={state?.settings.language ?? 'en'}>
      <WorkbenchView state={state} setState={setState} />
    </Localization>
  );
}

function WorkbenchView({ state, setState }: { state?: Snapshot; setState(snapshot: Snapshot): void }) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState(newDraft);
  const [setup, setSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialSettingsCategory, setInitialSettingsCategory] = useState<SettingsCategory>();
  const settingsPage = useRef<SettingsPageActions>(null);
  const leavingSettings = useRef(false);
  const workspace = useRef<WorkspaceActions>(null);
  const { notices, report, dismiss } = useNotices();
  const location = usePanelLocation({
    snapshot: state,
    visible: !settingsOpen && !setup,
    activateProject: id => window.workbench.activateProject(id),
    showWorkbench: () => setSetup(false),
    report,
  });
  useEffect(() => {
    let unsubscribe = () => {};
    void window.workbench
      .snapshot()
      .then(async snapshot => {
        const dark = snapshot.resolvedTheme === 'dark';
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        configureTerminals(dark, report);
        setState(snapshot);
        setSetup(!snapshot.projects.length);
        snapshot.errors.forEach(message => report(message));
        reconcileTerminals(snapshot.projects);
        unsubscribe = window.workbench.subscribe(event => {
          // Each snapshot is drawn as it arrives: the layout area compares consecutive saved layouts, so batching
          // two snapshots into one render could hide a save that returns to the layout before the last one.
          if (event.kind === 'snapshot') {
            reconcileTerminals(event.snapshot.projects);
            flushSync(() => setState(event.snapshot));
          } else if (event.kind === 'error') report(event.message);
          terminalEvent(event);
        });
        await window.workbench.ready();
      })
      .catch(error => report(error.message));
    return () => unsubscribe();
  }, []);
  async function leaveSettings(action: () => void = () => {}) {
    if (leavingSettings.current) return;
    leavingSettings.current = true;
    try {
      if ((await settingsPage.current?.requestLeave()) ?? true) {
        setSettingsOpen(false);
        action();
      }
    } catch (error) {
      report((error as Error).message);
    } finally {
      leavingSettings.current = false;
    }
  }
  const navigate = (action: () => void) => {
    if (settingsOpen) void leaveSettings(action);
    else action();
  };
  const openSettings = (category?: SettingsCategory) => {
    if (settingsOpen) {
      if (category) settingsPage.current?.showCategory(category);
    } else
      location.leaveWorkbench(() => {
        setInitialSettingsCategory(category);
        setSettingsOpen(true);
      });
  };
  const openAgentSettings = () => openSettings('agents');
  const toggleSettings = () => {
    if (settingsOpen) void leaveSettings();
    else openSettings();
  };
  const activate = (id: string) => navigate(() => location.openProject(id));
  const create = () => navigate(() => location.leaveWorkbench(() => setSetup(true)));
  const locatePanel = (projectId: string, panelId: string, runId?: string) =>
    navigate(() => location.locatePanel(projectId, panelId, runId));
  const windowWidth = useWindowWidth();
  const [lastResized, setLastResized] = useState<Region>('navigation');
  /** How each region was last drawn: a drag starts from it. */
  const drawn = useRef<Record<Region, RegionFit>>(undefined);
  const widestOnResize: WidestOnResize = region => {
    setLastResized(region);
    return drawn.current![region].widest;
  };
  const navigation = useProjectNavigation({
    snapshot: state,
    page: settingsOpen ? 'settings' : setup ? 'setup' : 'workbench',
    view: location.view,
    openProject: activate,
    // The sidebar shows the current project, so the project whose binding it opens on becomes current.
    openBinding: project =>
      navigate(() => {
        if (state?.activeProjectId !== project.id) location.openProject(project.id);
        forgeSidebar.openBinding(project);
      }),
    locatePanel,
    createProject: create,
    toggleSettings,
    widestOnResize,
    report,
  });
  const active = state?.projects.find(project => project.id === state.activeProjectId);
  // The forge sidebar shows the current project, on the workbench and on the settings page.
  const forgeSidebar = useForgeSidebar({
    snapshot: state,
    project: setup ? undefined : active,
    locatePanel,
    widestOnResize,
    report,
  });
  // The window bounds how the regions are drawn, never their remembered widths.
  const fits = fitRegions(
    windowWidth,
    {
      navigation: navigation.width,
      forgeSidebar: forgeSidebar.shown ? forgeSidebar.width : 0,
      detail: forgeSidebar.detail.shown ? forgeSidebar.detail.width : 0,
    },
    lastResized,
  );
  drawn.current = fits;
  const conflictCategory = state?.settingsConflicts[0]?.category;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !state ||
        !document.hasFocus() ||
        (event.target as HTMLElement).closest('[data-shortcut-recorder]') ||
        document.querySelector('dialog[open]')
      )
        return;
      const binding = shortcutFromEvent(event);
      const action = shortcutActions.find(action => state.settings.shortcuts[action] === binding);
      if (!action) return;
      let handled = false;
      if (action === 'settings') {
        toggleSettings();
        handled = true;
      } else if (action === 'toggleForgeSidebar') handled = forgeSidebar.toggle();
      else if (action === 'openDispatchMenu' || action === 'locateDispatchedPanel')
        handled = forgeSidebar.handleIssueShortcut(action);
      else if (!settingsOpen && (action === 'nextProject' || action === 'previousProject') && state.projects.length) {
        const index = state.projects.findIndex(project => project.id === state.activeProjectId);
        const next = (index + (action === 'nextProject' ? 1 : -1) + state.projects.length) % state.projects.length;
        activate(state.projects[next].id);
        handled = true;
      } else if (!settingsOpen && !setup) handled = workspace.current?.shortcut(action) ?? false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  });
  return (
    <div className="app">
      <header className="system-bar">
        <div className="system-brand">
          {navigation.toggle}
          <span className="wordmark">VibeBridge</span>
        </div>
        {forgeSidebar.button}
      </header>
      <div
        className={`app-body ${forgeSidebar.shown && forgeSidebar.overlay ? 'forge-sidebar-yield' : ''} ${forgeSidebar.detail.squeeze ? 'forge-detail-squeeze' : ''}`}
        style={
          {
            '--navigation-width': `${fits.navigation.width}px`,
            '--forge-sidebar-width': `${fits.forgeSidebar.width}px`,
            '--forge-detail-width': `${fits.detail.width}px`,
          } as CSSProperties
        }
      >
        {navigation.sidebar}
        <main>
          <div
            className={`workbench-page ${location.locating ? 'locating-panel' : ''}`}
            hidden={settingsOpen}
            inert={settingsOpen}
          >
            {!state ? (
              <div className="empty">{t('opening')}</div>
            ) : setup ? (
              <Setup
                defaultLayout={state.settings.defaultLayout}
                draft={draft}
                change={setDraft}
                cancel={() => setSetup(false)}
                created={id => {
                  setDraft(newDraft());
                  activate(id);
                }}
                openProject={activate}
                report={report}
                openAgentSettings={openAgentSettings}
              />
            ) : active ? (
              <Workspace
                ref={workspace}
                visible={!settingsOpen}
                key={active.id}
                project={active}
                report={report}
                openAgentSettings={openAgentSettings}
                location={location}
              />
            ) : (
              <div className="empty">
                <p>{t('welcome')}</p>
                <button className="primary" onClick={create}>
                  {t('createProject')}
                </button>
              </div>
            )}
          </div>
          {state && settingsOpen && (
            <SettingsPage
              ref={settingsPage}
              settings={state.settings}
              startupTheme={state.startupTheme}
              initialCategory={initialSettingsCategory}
              report={report}
              back={() => void leaveSettings()}
            />
          )}
        </main>
        {forgeSidebar.sidebar}
      </div>
      <Notices notices={notices} dismiss={dismiss} />
      <HoverHints />
      {conflictCategory && !settingsOpen && (
        <SettingsConflictDialog category={conflictCategory} openSettings={() => openSettings(conflictCategory)} />
      )}
    </div>
  );
}
