import { useLocalization } from '../common/Localization';
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react';
import { displayShortcut, type IssueShortcutAction } from '../../shared/settings/shortcuts';
import type { DesktopAPI } from '../../shared/api';
import type { ProjectView, Snapshot } from '../../shared/model';
import { useSidebarPreferences } from '../common/sidebar-preferences';
import { ChangeBinding, UnboundRepository } from './SidebarBinding';
import { ForgeLists, openListsView, type DetailHost, type ForgeListsActions, type ListsView } from './ForgeLists';
import { SidebarHead } from './SidebarHead';
import type { DispatchTarget } from '../../shared/dispatch';
import { capturePointer } from '../common/pointer-capture';
import { requireValue } from '../common/required';
import type { ReportNotice } from '../common/Notices';
import { draggedWidth, type WidestOnResize } from '../common/region-widths';
import './forge-sidebar.css';

interface Host {
  snapshot?: Snapshot;
  /** The project whose data the sidebar shows, or none (no project, or project setup). */
  project?: ProjectView;
  /** Locates a panel; an ephemeral one opens as its temporary maximize. */
  locatePanel(projectId: string, panelId: string): void;
  widestOnResize: WidestOnResize;
  report: ReportNotice;
}

/** The detail's width while the app runs, and the narrowest that keeps its content whole. */
const detailWidth = { initial: 640, min: 420 };

// Keep this hook in the main window's lifetime. The forge sidebar's open state and width are one for the
// whole app; what it shows is the current project's. Opening it moves focus inside; closing leaves focus alone.
// An issue detail opens leftwards from the sidebar; with squeeze coexistence the layout area gives up its width too.
export function useForgeSidebar(host: Host, api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, project } = host;
  const {
    preferences,
    toggle: togglePreferences,
    startResize,
  } = useSidebarPreferences({
    sidebar: 'forgeSidebar',
    snapshot,
    api,
    edge: -1,
    widestOnResize: host.widestOnResize,
    report: host.report,
  });
  const element = useRef<HTMLElement>(null);
  const focusOnOpen = useRef(false);
  /** Asks for focus in the sidebar while it is already shown. */
  const [focusRequest, setFocusRequest] = useState(0);
  /** The project and binding whose change-binding page the sidebar shows in place of the lists; a binding changed in
   * any way leaves it. */
  const [changingBindingOf, setChangingBindingOf] = useState<string>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [width, setWidth] = useState(detailWidth.initial);
  /** The target each command last went to, kept only while the app runs. */
  const [lastTargets, setLastTargets] = useState<ReadonlyMap<string, DispatchTarget>>(new Map());
  const listsActions = useRef<ForgeListsActions>(null);
  /** The tab and filters the lists last showed, per project and binding, kept while the app runs. */
  const listsViews = useRef(new Map<string, ListsView>());
  const detail: DetailHost = {
    onDetailOpenChange: setDetailOpen,
    startResize(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
      // The detail's right edge is the sidebar's left edge: dragging its left edge leftwards widens it.
      const start = event.clientX,
        from = requireValue(event.currentTarget.parentElement, 'the issue detail').getBoundingClientRect().width,
        widest = host.widestOnResize('detail');
      capturePointer(event.currentTarget, event.pointerId, {
        move: pointer => setWidth(draggedWidth(from - (pointer.clientX - start), detailWidth.min, widest)),
        finish: () => {},
      });
    },
  };
  const sidebarOpen = preferences.visible && !!project;
  /** The project with its binding: the lists are mounted per this, and the change-binding page shows only for it. */
  const bindingKey = project && keyOfBinding(project);
  useLayoutEffect(() => {
    if (sidebarOpen && focusOnOpen.current) requireValue(element.current, 'the forge sidebar').focus();
    focusOnOpen.current = false;
  }, [sidebarOpen, focusRequest]);
  // The intent is set first: the snapshot of the save may already draw the open sidebar.
  /** Shows or hides the sidebar. Without a current project there is no sidebar to show: nothing toggles, and it returns false. */
  function toggle() {
    if (!project) return false;
    focusOnOpen.current = !preferences.visible;
    if (!togglePreferences()) focusOnOpen.current = false;
    return true;
  }
  /** Shows the sidebar on `target`'s binding for when `target` is the current project: a bound project's change-binding
   * page, whose search takes focus, or an unbound project's state, with focus in the sidebar. */
  function openBinding(target: ProjectView) {
    const key = keyOfBinding(target);
    setChangingBindingOf(key);
    if (!key) {
      focusOnOpen.current = true;
      setFocusRequest(request => request + 1);
    }
    if (!preferences.visible) togglePreferences();
  }
  /** The issue shortcuts act only while focus is in the sidebar; elsewhere their keys go on, to a terminal. */
  const runIssueShortcut = (action: IssueShortcutAction) =>
    !!element.current?.contains(document.activeElement) && (listsActions.current?.runIssueShortcut(action) ?? false);
  // The toggle names the current project's forge; without a project it names the sidebar by what it shows.
  const label = project
    ? t(preferences.visible ? 'closeForgeSidebar' : 'openForgeSidebar', { forge: project.forge.name })
    : t('toggleForgeSidebar');
  const toggleShortcut = snapshot?.settings.shortcuts.toggleForgeSidebar;
  const overlay = snapshot?.settings.sidebarCoexistence === 'overlay';
  return {
    toggle,
    openBinding,
    runIssueShortcut,
    shown: sidebarOpen,
    overlay,
    /** The sidebar's remembered width. */
    width: preferences.width,
    /** Whether a detail is open, whether it squeezes the layout area, and its remembered width. */
    detail: {
      shown: sidebarOpen && detailOpen,
      squeeze: sidebarOpen && detailOpen && snapshot?.settings.detailCoexistence === 'squeeze',
      width,
    },
    button: (
      <button
        className="forge-sidebar-toggle"
        aria-label={label}
        data-hint={toggleShortcut ? `${label} (${displayShortcut(toggleShortcut)})` : label}
        aria-expanded={sidebarOpen}
        disabled={!project}
        onClick={toggle}
      >
        {sidebarOpen ? <SidebarCollapseIcon size={16} /> : <SidebarExpandIcon size={16} />}
      </button>
    ),
    sidebar: sidebarOpen && project && snapshot && (
      <aside
        ref={element}
        tabIndex={-1}
        className={`forge-sidebar ${overlay ? 'overlay' : ''}`}
        aria-label={project.forge.name}
      >
        <div
          className="forge-sidebar-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('resizeForgeSidebar', { forge: project.forge.name })}
          onPointerDown={startResize}
        />
        {project.repository && changingBindingOf === bindingKey ? (
          <>
            <SidebarHead title={project.repository.path} />
            <ChangeBinding
              key={project.id}
              project={{ ...project, repository: project.repository }}
              back={() => {
                setChangingBindingOf(undefined);
                // The page's controls leave with it; focus stays in the sidebar.
                requireValue(element.current, 'the forge sidebar').focus();
              }}
            />
          </>
        ) : project.repository && bindingKey ? (
          // Mounted per project and repository: returning to a project shows the tab and filters it last showed, and
          // rebinding starts from open with no filter.
          <ForgeLists
            ref={listsActions}
            key={bindingKey}
            view={listsViews.current.get(bindingKey) ?? openListsView}
            rememberView={view => void listsViews.current.set(bindingKey, view)}
            project={{ ...project, repository: project.repository }}
            changeBinding={() => setChangingBindingOf(bindingKey)}
            detailHost={detail}
            dispatchHost={{
              workflows: snapshot.settings.workflows,
              openMenuShortcut: snapshot.settings.shortcuts.openDispatchMenu,
              lastTargets,
              locate: host.locatePanel,
              locateBinding: snapshot.settings.shortcuts.locateDispatchedPanel,
              report: host.report,
              rememberLastTarget: (command, target) => setLastTargets(targets => new Map(targets).set(command, target)),
            }}
          />
        ) : (
          <>
            <SidebarHead title={t('noRepositoryBound')} />
            <UnboundRepository key={project.id} project={project} />
          </>
        )}
      </aside>
    ),
  };
}

/** A bound project with its binding, or undefined for an unbound one. */
const keyOfBinding = ({ id, repository }: ProjectView) =>
  repository ? `${id} ${repository.forge} ${repository.host} ${repository.id}` : undefined;
