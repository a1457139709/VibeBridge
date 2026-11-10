import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { DesktopAPI } from '../shared/api';
import { platformDescriptions } from '../shared/code-hosting';
import { defaultIssueSidebar, issueSidebarWidth, type ProjectView, type Snapshot } from '../shared/model';
import { useLocalization } from './Localization';
import { useSavedPreferences } from './saved-preferences';
import { IssueLists } from './IssueLists';
import './issue-sidebar.css';

interface Host {
  snapshot?: Snapshot;
  /** The project whose repository the sidebar shows; it follows the active project on every page. */
  project?: ProjectView;
  /** Opens the project editor on its repository field. */
  bindRepository(project: ProjectView): void;
  report(message: string): void;
}

// Keep this hook in the main window's lifetime: its open state and width are one for the whole app.
export function useIssueSidebar(host: Host, api: Pick<DesktopAPI, 'saveIssueSidebar' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, project } = host;
  const { preferences, toggle, resize } = useSavedPreferences({ snapshot, read: snapshot => snapshot.issueSidebar, fallback: defaultIssueSidebar,
    save: preferences => api.saveIssueSidebar(preferences), clamp: issueSidebarWidth, edge: 'left', report: host.report }, api);
  const element = useRef<HTMLElement>(null);
  // Only the shortcut moves focus in, once the sidebar has rendered open.
  const focusOnOpen = useRef(false);
  useLayoutEffect(() => {
    if (preferences.visible && focusOnOpen.current) element.current?.focus();
    focusOnOpen.current = false;
  }, [preferences.visible]);
  const visible = preferences.visible;
  const repository = project?.repository;
  const title = repository ? platformDescriptions[repository.platform].name : t('issueSidebar');
  return {
    visible,
    width: preferences.width,
    /** The shortcut: opens the sidebar with focus inside it, or closes it wherever focus is. */
    toggleWithFocus() { focusOnOpen.current = !visible; toggle(); },
    toggle: <button className="issue-sidebar-toggle" aria-label={visible ? t('closeIssueSidebar') : t('openIssueSidebar')} aria-expanded={visible}
      disabled={!snapshot} onClick={() => toggle()}><SidebarIcon /></button>,
    sidebar: visible && <aside ref={element} tabIndex={-1} className="issue-sidebar" aria-label={title}
      style={{ '--issue-sidebar-width': `${preferences.width}px` } as CSSProperties}>
      <div className="issue-sidebar-resize" role="separator" aria-label={t('resizeIssueSidebar')} aria-orientation="vertical" onPointerDown={resize} />
      <header className="issue-sidebar-heading"><span className="issue-sidebar-title">{title}</span>
        {repository && <span className="issue-sidebar-repository">{repository.path}</span>}</header>
      {project && repository && <IssueLists key={`${project.id}:${repository.platform}:${repository.path}`} projectId={project.id} repository={repository}
        changeBinding={() => host.bindRepository(project)} />}
      {project && !repository && <div className="issue-sidebar-state">
        <p>{t('issueSidebarUnbound')}</p>
        <button className="primary" onClick={() => host.bindRepository(project)}>{t('bindRepository')}</button>
      </div>}
    </aside>,
  };
}

function SidebarIcon() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" />
    <path d="M10 2.5v11" stroke="currentColor" /></svg>;
}
