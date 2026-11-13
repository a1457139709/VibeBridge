import { useLocalization } from './Localization';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react';
import { displayShortcut } from '../shared/shortcuts';
import type { DesktopAPI } from '../shared/api';
import type { ProjectView, Snapshot } from '../shared/model';
import { useSidebarPreferences } from './sidebar-preferences';
import { ProjectEditor } from './ProjectManagement';
import { ForgeLists, SidebarHead, type DetailHost } from './ForgeLists';
import { capturePointer } from './pointer-capture';
import './forge-sidebar.css';

interface Host {
  snapshot?: Snapshot;
  /** The project whose data the sidebar shows, or none (no project, or project setup). */
  project?: ProjectView;
  openProject(id: string): void;
  report(message: string): void;
}

/** The detail's width while the app runs: dragging its left edge sets it within these bounds. */
const detailWidth = { initial: 640, min: 420, max: 1100 };

// Keep this hook in the main window's lifetime. The forge sidebar's open state and width are one for the
// whole app; what it shows is the current project's. Opening it moves focus inside; closing leaves focus alone.
// An issue detail opens leftwards from the sidebar; with squeeze coexistence the layout area gives up its width too.
export function useForgeSidebar(host: Host, api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, project } = host;
  const { preferences, toggle: togglePreferences, resize } = useSidebarPreferences({ sidebar: 'forgeSidebar', snapshot, api, edge: -1, report: host.report });
  const element = useRef<HTMLElement>(null);
  const focusOnOpen = useRef(false);
  const [editingRepository, setEditingRepository] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [width, setWidth] = useState(detailWidth.initial);
  const detail: DetailHost = { width, shown: setDetailOpen, resize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    // The detail's right edge is the sidebar's left edge: dragging its left edge leftwards widens it.
    const start = event.clientX, from = event.currentTarget.parentElement!.getBoundingClientRect().width;
    capturePointer(event.currentTarget, event.pointerId, {
      move: pointer => setWidth(Math.round(Math.max(detailWidth.min, Math.min(detailWidth.max, from - (pointer.clientX - start))))),
      finish: () => {},
    });
  } };
  const shown = preferences.visible && !!project;
  useLayoutEffect(() => {
    if (shown && focusOnOpen.current) element.current!.focus();
    focusOnOpen.current = false;
  }, [shown]);
  // The intent is set first: the snapshot of the save may already draw the open sidebar.
  /** Shows or hides the sidebar. Without a current project there is no sidebar to show: nothing toggles, and it returns false. */
  function toggle() {
    if (!project) return false;
    focusOnOpen.current = !preferences.visible;
    if (!togglePreferences()) focusOnOpen.current = false;
    return true;
  }
  // The toggle names the current project's forge; without a project it names the sidebar by what it shows.
  const label = project ? t(preferences.visible ? 'closeForgeSidebar' : 'openForgeSidebar', { forge: project.forge.name }) : t('toggleForgeSidebar');
  const binding = snapshot?.settings.shortcuts.toggleForgeSidebar;
  const overlay = snapshot?.settings.sidebarCoexistence === 'overlay';
  return {
    toggle,
    shown, overlay, width: preferences.width,
    /** Whether an open detail squeezes the layout area, and its width. */
    detail: { squeeze: shown && detailOpen && snapshot?.settings.detailCoexistence === 'squeeze', width },
    button: <button className="forge-sidebar-toggle" aria-label={label} data-hint={binding ? `${label} (${displayShortcut(binding)})` : label}
      aria-expanded={shown} disabled={!project} onClick={toggle}>{shown ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}</button>,
    sidebar: shown && project && <aside ref={element} tabIndex={-1} className={`forge-sidebar ${overlay ? 'overlay' : ''}`} aria-label={project.forge.name}
      style={{ width: preferences.width }}>
      <div className="forge-sidebar-resize" role="separator" aria-orientation="vertical" aria-label={t('resizeForgeSidebar', { forge: project.forge.name })} onPointerDown={resize} />
      {project.repository
        // Mounted per project and repository: returning to a project or rebinding starts the lists afresh.
        ? <ForgeLists key={`${project.id} ${project.repository.forge} ${project.repository.path}`} project={{ ...project, repository: project.repository }}
          editBinding={() => setEditingRepository(true)} detailHost={detail} />
        : <>
          <SidebarHead title={t('noRepositoryBound')} />
          <div className="forge-sidebar-state">
            <p>{t('projectUnbound', { forge: project.forge.name })}</p>
            <button className="primary" onClick={() => setEditingRepository(true)}>{t('bindRepository')}</button>
          </div>
        </>}
      {editingRepository && <ProjectEditor project={project} focusRepository close={() => setEditingRepository(false)}
        openProject={id => { setEditingRepository(false); host.openProject(id); }} />}
    </aside>,
  };
}
