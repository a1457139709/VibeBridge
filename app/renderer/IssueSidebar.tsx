import { useLocalization } from './Localization';
import { useLayoutEffect, useRef, useState } from 'react';
import type { DesktopAPI } from '../shared/api';
import { defaultIssueSidebar, issueSidebarWidth, type ProjectView, type Snapshot } from '../shared/model';
import { useSidebarPreferences } from './sidebar-preferences';
import { ProjectEditor } from './ProjectManagement';
import './issue-sidebar.css';

interface Host {
  snapshot?: Snapshot;
  /** The project whose data the sidebar shows, or none (no project, or project setup). */
  project?: ProjectView;
  openProject(id: string): void;
  report(message: string): void;
}

const SidebarIcon = ({ open }: { open: boolean }) => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
  <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
  <rect x={open ? 9 : 10} y="3.5" width={open ? 4.5 : 0.75} height="9" fill="currentColor" />
</svg>;

// Keep this hook in the main window's lifetime. The issue sidebar's open state and width are one for the
// whole app; what it shows is the current project's. Opening it moves focus inside; closing leaves focus alone.
export function useIssueSidebar(host: Host, api: Pick<DesktopAPI, 'saveIssueSidebar' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, project } = host;
  const { preferences, toggle: togglePreferences, resize } = useSidebarPreferences({ snapshot, read: value => value.issueSidebar,
    save: preferences => api.saveIssueSidebar(preferences), subscribe: api.subscribe, defaults: defaultIssueSidebar,
    width: issueSidebarWidth, edge: -1, report: host.report });
  const element = useRef<HTMLElement>(null);
  const focusOnOpen = useRef(false);
  const [binding, setBinding] = useState(false);
  const shown = preferences.visible && !!project;
  useLayoutEffect(() => {
    if (shown && focusOnOpen.current) element.current!.focus();
    focusOnOpen.current = false;
  }, [shown]);
  // The intent is set first: the snapshot of the save may already draw the open sidebar.
  function toggle() {
    if (!snapshot) return;
    focusOnOpen.current = !preferences.visible;
    if (!togglePreferences()) focusOnOpen.current = false;
  }
  // The toggle names the current project's forge; without a project it names the sidebar by what it shows.
  const label = project ? t(preferences.visible ? 'closeIssueSidebar' : 'openIssueSidebar', { forge: project.forge.name }) : t('toggleIssueSidebar');
  const overlay = snapshot?.settings.sidebarCoexistence === 'overlay';
  return {
    toggle,
    shown, overlay, width: preferences.width,
    button: <button className="issue-sidebar-toggle" aria-label={label}
      aria-expanded={preferences.visible} disabled={!snapshot} onClick={toggle}><SidebarIcon open={preferences.visible} /></button>,
    sidebar: shown && project && <aside ref={element} tabIndex={-1} className={`issue-sidebar ${overlay ? 'overlay' : ''}`} aria-label={project.forge.name}
      style={{ width: preferences.width }}>
      <div className="issue-sidebar-resize" role="separator" aria-orientation="vertical" aria-label={t('resizeIssueSidebar', { forge: project.forge.name })} onPointerDown={resize} />
      <header className="issue-sidebar-head"><span className="issue-sidebar-repository">{project.repository?.path ?? t('noRepositoryBound')}</span></header>
      {!project.repository && <div className="issue-sidebar-state">
        <p>{t('projectUnbound', { forge: project.forge.name })}</p>
        <button className="primary" onClick={() => setBinding(true)}>{t('bindRepository')}</button>
      </div>}
      {binding && <ProjectEditor project={project} focus="repository" close={() => setBinding(false)}
        openProject={id => { setBinding(false); host.openProject(id); }} />}
    </aside>,
  };
}
