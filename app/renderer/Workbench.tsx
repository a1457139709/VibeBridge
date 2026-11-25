import { HoverHints } from './common/HoverHints';
import { Localization, useLocalization } from './common/Localization';
import { useRef, useState } from 'react';
import { useSubscription, type Subscribe } from './common/effects/subscription';
import { useEventListener } from './common/effects/event-listener';
import { flushSync } from 'react-dom';
import type {} from '../shared/api';
import { newDraft, type Snapshot, type WorkbenchEvent } from '../shared/model';
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
import { configureTerminals, reconcileTerminals, applyTerminalEvent, setTerminalLanguage } from './panels/terminals';
import { errorMessage } from '../shared/caught-error';
import { requireValue } from './common/required';

type WorkbenchConnection =
  | { kind: 'opened'; snapshot: Snapshot }
  | { kind: 'openFailed'; error: unknown }
  | { kind: 'event'; event: WorkbenchEvent };

const connectToWorkbench: Subscribe<WorkbenchConnection> = receive => {
  let unsubscribe = () => {};
  void window.workbench
    .fetchSnapshot()
    .then(async snapshot => {
      receive({ kind: 'opened', snapshot });
      unsubscribe = window.workbench.subscribe(event => receive({ kind: 'event', event }));
      await window.workbench.reportRendererReady();
    })
    .catch(error => receive({ kind: 'openFailed', error }));
  return () => unsubscribe();
};

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const showSnapshot = (next: Snapshot) => {
    document.documentElement.lang = next.settings.language;
    setTerminalLanguage(next.settings.language);
    setSnapshot(next);
  };
  return (
    <Localization language={snapshot?.settings.language ?? 'en'}>
      <WorkbenchView snapshot={snapshot} showSnapshot={showSnapshot} />
    </Localization>
  );
}

function WorkbenchView({ snapshot, showSnapshot }: { snapshot?: Snapshot; showSnapshot(snapshot: Snapshot): void }) {
  const { t } = useLocalization();
  const [draft, setDraft] = useState(newDraft);
  const [setupOpen, setSetupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [initialSettingsCategory, setInitialSettingsCategory] = useState<SettingsCategory>();
  const settingsPage = useRef<SettingsPageActions>(null);
  const leavingSettings = useRef(false);
  const workspace = useRef<WorkspaceActions>(null);
  const { notices, report, dismiss } = useNotices();
  const location = usePanelLocation({
    snapshot: snapshot,
    visible: !settingsOpen && !setupOpen,
    activateProject: id => window.workbench.activateProject(id),
    showWorkbench: () => setSetupOpen(false),
    report,
  });
  useSubscription(connectToWorkbench, connection => {
    if (connection.kind === 'opened') {
      const initial = connection.snapshot;
      const dark = initial.resolvedTheme === 'dark';
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      configureTerminals(dark, report);
      showSnapshot(initial);
      setSetupOpen(!initial.projects.length);
      initial.errors.forEach(message => report(message));
      reconcileTerminals(initial.projects);
    } else if (connection.kind === 'openFailed') report(errorMessage(connection.error));
    else {
      const { event } = connection;
      if (event.kind === 'snapshot') {
        reconcileTerminals(event.snapshot.projects);
        flushSync(() => showSnapshot(event.snapshot));
      } else if (event.kind === 'error') report(event.message);
      applyTerminalEvent(event);
    }
  });
  async function leaveSettings(action: () => void = () => {}) {
    if (leavingSettings.current) return;
    leavingSettings.current = true;
    try {
      if ((await settingsPage.current?.requestLeave()) ?? true) {
        setSettingsOpen(false);
        action();
      }
    } catch (error) {
      report(errorMessage(error));
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
  const openProject = (id: string) => navigate(() => location.openProject(id));
  const openSetup = () => navigate(() => location.leaveWorkbench(() => setSetupOpen(true)));
  const locatePanel = (projectId: string, panelId: string, runId?: string) =>
    navigate(() => location.locatePanel(projectId, panelId, runId));
  const windowWidth = useWindowWidth();
  const [lastResized, setLastResized] = useState<Region>('navigation');
  const drawn = useRef<Record<Region, RegionFit>>(undefined);
  const widestOnResize: WidestOnResize = region => {
    setLastResized(region);
    return requireValue(drawn.current, 'the drawn regions')[region].widest;
  };
  const navigation = useProjectNavigation({
    snapshot: snapshot,
    page: settingsOpen ? 'settings' : setupOpen ? 'setup' : 'workbench',
    view: location.view,
    openProject: openProject,
    openBinding: project =>
      navigate(() => {
        if (snapshot?.activeProjectId !== project.id) location.openProject(project.id);
        forgeSidebar.openBinding(project);
      }),
    locatePanel,
    openSetup: openSetup,
    toggleSettings,
    widestOnResize,
    report,
  });
  const active = snapshot?.projects.find(project => project.id === snapshot.activeProjectId);
  const forgeSidebar = useForgeSidebar({
    snapshot: snapshot,
    project: setupOpen ? undefined : active,
    locatePanel,
    widestOnResize,
    report,
  });
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
  const conflictCategory = snapshot?.settingsConflicts[0]?.category;
  useEventListener(
    window,
    'keydown',
    event => {
      if (
        !snapshot ||
        !document.hasFocus() ||
        (event.target instanceof Element && event.target.closest('[data-shortcut-recorder]')) ||
        document.querySelector('dialog[open]')
      )
        return;
      const binding = shortcutFromEvent(event);
      const action = shortcutActions.find(action => snapshot.settings.shortcuts[action] === binding);
      if (!action) return;
      let handled = false;
      if (action === 'settings') {
        toggleSettings();
        handled = true;
      } else if (action === 'toggleForgeSidebar') handled = forgeSidebar.toggle();
      else if (action === 'openDispatchMenu' || action === 'locateDispatchedPanel')
        handled = forgeSidebar.runIssueShortcut(action);
      else if (
        !settingsOpen &&
        (action === 'nextProject' || action === 'previousProject') &&
        snapshot.projects.length
      ) {
        const index = snapshot.projects.findIndex(project => project.id === snapshot.activeProjectId);
        const next =
          (index + (action === 'nextProject' ? 1 : -1) + snapshot.projects.length) % snapshot.projects.length;
        openProject(snapshot.projects[next].id);
        handled = true;
      } else if (!settingsOpen && !setupOpen) handled = workspace.current?.runShortcut(action) ?? false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
  return (
    <div className="app">
      <header className="system-bar">
        <div className="system-brand">
          {navigation.toggleButton}
          <span className="wordmark">VibeBridge</span>
        </div>
        {forgeSidebar.button}
      </header>
      <div
        className={`app-body ${forgeSidebar.shown && forgeSidebar.overlay ? 'forge-sidebar-yield' : ''} ${forgeSidebar.detail.squeeze ? 'forge-detail-squeeze' : ''}`}
        style={{
          '--navigation-width': `${fits.navigation.width}px`,
          '--forge-sidebar-width': `${fits.forgeSidebar.width}px`,
          '--forge-detail-width': `${fits.detail.width}px`,
        }}
      >
        {navigation.sidebar}
        <main>
          <div
            className={`workbench-page ${location.locating ? 'locating-panel' : ''}`}
            hidden={settingsOpen}
            inert={settingsOpen}
          >
            {!snapshot ? (
              <div className="empty">{t('opening')}</div>
            ) : setupOpen ? (
              <Setup
                defaultLayout={snapshot.settings.defaultLayout}
                draft={draft}
                changeDraft={setDraft}
                cancel={() => setSetupOpen(false)}
                onSetupFinished={id => {
                  setDraft(newDraft());
                  openProject(id);
                }}
                openProject={openProject}
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
                <button className="primary" onClick={openSetup}>
                  {t('createProject')}
                </button>
              </div>
            )}
          </div>
          {snapshot && settingsOpen && (
            <SettingsPage
              ref={settingsPage}
              settings={snapshot.settings}
              startupTheme={snapshot.startupTheme}
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
