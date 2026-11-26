import { useLocalization } from '../common/Localization';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { flushSync } from 'react-dom';
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
  project?: ProjectView;
  locatePanel(projectId: string, panelId: string): void;
  widestOnResize: WidestOnResize;
  report: ReportNotice;
}

const detailWidth = { initial: 640, min: 420 };

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
  const [changingBindingOf, setChangingBindingOf] = useState<string>();
  const [detailOpenIn, setDetailOpenIn] = useState<string>();
  const [width, setWidth] = useState(detailWidth.initial);
  const [lastTargets, setLastTargets] = useState<ReadonlyMap<string, DispatchTarget>>(new Map());
  const listsActions = useRef<ForgeListsActions>(null);
  const [listsViews, setListsViews] = useState<ReadonlyMap<string, ListsView>>(new Map());
  const detail: DetailHost = {
    onDetailOpenChange: open => setDetailOpenIn(open ? bindingKey : undefined),
    startResize(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0) return;
      event.preventDefault();
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
  const bindingKey = project && keyOfBinding(project);
  const listsShownFor = sidebarOpen && changingBindingOf !== bindingKey ? bindingKey : undefined;
  if (detailOpenIn !== undefined && detailOpenIn !== listsShownFor) setDetailOpenIn(undefined);
  const detailOpen = detailOpenIn !== undefined && detailOpenIn === listsShownFor;
  function toggle() {
    if (!project) return false;
    const opening = !preferences.visible;
    let opened = false;
    flushSync(() => {
      opened = togglePreferences();
    });
    if (opening && opened) element.current?.focus();
    return true;
  }
  function openBinding(target: ProjectView) {
    const key = keyOfBinding(target);
    flushSync(() => {
      setChangingBindingOf(key);
      if (!preferences.visible) togglePreferences();
    });
    if (!key) element.current?.focus();
  }
  const runIssueShortcut = (action: IssueShortcutAction) =>
    !!element.current?.contains(document.activeElement) && (listsActions.current?.runIssueShortcut(action) ?? false);
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
    width: preferences.width,
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
                requireValue(element.current, 'the forge sidebar').focus();
              }}
            />
          </>
        ) : project.repository && bindingKey ? (
          <ForgeLists
            ref={listsActions}
            key={bindingKey}
            view={listsViews.get(bindingKey) ?? openListsView}
            rememberView={view => setListsViews(views => new Map(views).set(bindingKey, view))}
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

const keyOfBinding = ({ id, repository }: ProjectView) =>
  repository ? `${id} ${repository.forge} ${repository.host} ${repository.id}` : undefined;
