import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { DesktopAPI } from '../shared/api';
import { platformDescriptions, type PlatformFailure, type RepositoryItem } from '../shared/code-hosting';
import { defaultIssueSidebar, issueSidebarWidth, type ProjectView, type Snapshot } from '../shared/model';
import { useLocalization } from './Localization';
import { useSavedPreferences } from './saved-preferences';
import { FailureState, IssueLists, unfiltered } from './IssueLists';
import type { DirectActionHost } from './DirectActions';
import { IssueDetailView } from './IssueDetail';
import { MergeRequestDetailView } from './MergeRequestDetail';
import { issueRow } from './issue-navigation';
import './issue-sidebar.css';

interface Host {
  snapshot?: Snapshot;
  /** The project whose repository the sidebar shows; it follows the active project on every page. */
  project?: ProjectView;
  /** Opens the project editor on its repository field. */
  bindRepository(project: ProjectView): void;
  /** Shows a panel as locating does elsewhere: an ephemeral one opens temporarily maximized. */
  locatePanel(projectId: string, panelId: string, runId: string): void;
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
  // The open detail belongs to one project and binding; it closes with the sidebar.
  const lists = project && repository ? `${project.id}:${repository.platform}:${repository.path}` : undefined;
  const [opened, setOpened] = useState<{ lists: string; item: RepositoryItem }>();
  const openedItem = visible && opened && opened.lists === lists ? opened.item : undefined;
  const open = (item: RepositoryItem) => { if (lists) setOpened({ lists, item }); };
  const closeDetail = () => setOpened(undefined);
  const opening = (kind: RepositoryItem['kind']) => ({ opened: openedItem?.kind === kind ? openedItem.number : undefined, open: (number: number) => open({ kind, number }) });
  const returnToList = (number: number) => {
    closeDetail();
    (issueRow(element.current, number) ?? element.current)?.focus();
  };
  // Search and filters last while the sidebar shows this project and binding, across closing it and retrying; they reset on a switch.
  const [filtered, setFiltered] = useState({ lists, filters: unfiltered });
  if (filtered.lists !== lists) setFiltered({ lists, filters: unfiltered });
  // A direct action's success or a dispatch refreshes the lists once; a platform CLI found missing or signed out takes their place until retried.
  // A refused action's line clears on any refresh of the lists.
  const [changes, setChanges] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const [unavailable, setUnavailable] = useState<{ lists: string; failure: PlatformFailure }>();
  const shownUnavailable = unavailable?.lists === lists ? unavailable?.failure : undefined;
  const actionHost: DirectActionHost = { refreshes, changed: () => setChanges(count => count + 1),
    unavailable: failure => { if (lists) { closeDetail(); setUnavailable({ lists, failure }); } } };
  const title = repository ? platformDescriptions[repository.platform].name : t('issueSidebar');
  return {
    visible,
    width: preferences.width,
    /** The shortcut: opens the sidebar with focus inside it, or closes it wherever focus is. */
    toggleWithFocus() { focusOnOpen.current = !visible; closeDetail(); toggle(); },
    /** Whether an issue's or merge request's detail is open beside the sidebar. */
    detailOpen: openedItem !== undefined,
    /** Lies left of the sidebar; the host places it over or beside the layout area. */
    detail: project && repository && openedItem && (openedItem.kind === 'mergeRequest'
      ? <MergeRequestDetailView key={`${lists}:mergeRequest#${openedItem.number}`} projectId={project.id}
        repository={repository} number={openedItem.number} open={open} close={closeDetail} host={actionHost} />
      : <IssueDetailView key={`${lists}:issue#${openedItem.number}`} project={project} repository={repository} number={openedItem.number}
        workflows={snapshot!.settings.workflows} shortcuts={snapshot!.settings.shortcuts} open={open} close={closeDetail}
        returnToList={() => returnToList(openedItem.number)} host={actionHost}
        locate={location => { closeDetail(); host.locatePanel(location.projectId, location.panelId, location.runId); }} />),
    toggle: <button className="issue-sidebar-toggle" aria-label={visible ? t('closeIssueSidebar') : t('openIssueSidebar')} aria-expanded={visible}
      disabled={!snapshot} onClick={() => { closeDetail(); toggle(); }}><SidebarIcon /></button>,
    sidebar: visible && <aside ref={element} tabIndex={-1} className="issue-sidebar" aria-label={title}
      style={{ '--issue-sidebar-width': `${preferences.width}px` } as CSSProperties}>
      <div className="issue-sidebar-resize" role="separator" aria-label={t('resizeIssueSidebar')} aria-orientation="vertical" onPointerDown={resize} />
      <header className="issue-sidebar-heading"><span className="issue-sidebar-title">{title}</span>
        {repository && <span className="issue-sidebar-repository">{repository.path}</span>}</header>
      {project && repository && shownUnavailable && <FailureState failure={{ ok: false, failure: shownUnavailable }} path={repository.path}
        retry={() => setUnavailable(undefined)} changeBinding={() => host.bindRepository(project)} />}
      {project && repository && !shownUnavailable && <IssueLists key={lists} project={project} repository={repository} changes={changes} refreshed={() => setRefreshes(count => count + 1)}
        filters={filtered.filters} setFilters={update => setFiltered(current => ({ ...current, filters: update(current.filters) }))}
        workflows={snapshot!.settings.workflows} shortcuts={snapshot!.settings.shortcuts} changeBinding={() => host.bindRepository(project)}
        locate={location => host.locatePanel(location.projectId, location.panelId, location.runId)}
        filled={location => { closeDetail(); host.locatePanel(location.projectId, location.panelId, location.runId); }}
        detail={opening('issue')} mergeRequestDetail={opening('mergeRequest')} />}
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
