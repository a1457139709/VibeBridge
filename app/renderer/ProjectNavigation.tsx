import { useLocalization } from './Localization';
import { useEffect, useState, type CSSProperties } from 'react';
import type { DesktopAPI } from '../shared/api';
import { projectPanels, type PanelView, type ProjectView, type Snapshot } from '../shared/model';
import type { ProcessingState } from '../shared/processing-status';
import { agentIcons } from './agent-icons';
import type { PanelLocation } from './panel-location';
import { useSidebarPreferences } from './sidebar-preferences';
import { ProjectNavigationItem } from './ProjectManagement';
import { ProcessingStatusIcon } from './ProcessingStatusIcon';

const nameSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const projectInitial = (name: string) => nameSegments.segment(name)[Symbol.iterator]().next().value?.segment.toUpperCase() ?? '';

interface Host {
  snapshot?: Snapshot;
  page: 'workbench' | 'setup' | 'settings';
  view: PanelLocation['view'];
  openProject(id: string): void;
  locatePanel(projectId: string, panelId: string): void;
  createProject(): void;
  toggleSettings(): void;
  report(message: string): void;
}

// Keep this hook in the main window's lifetime. The two presentation entries
// share navigation interaction state; page permission and panel location stay
// with the host callbacks and the read-only view supplied by panel-location.
export function useProjectNavigation(host: Host, api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, page } = host;
  const { preferences, toggle, resize } = useSidebarPreferences({ sidebar: 'navigation', snapshot, api, edge: 1, report: host.report });
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  // Ephemeral groups start collapsed and their expansion lives only in this interface.
  const [expandedTrays, setExpandedTrays] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const id = snapshot?.activeProjectId;
    if (id) setExpandedProjects(previous => previous[id] === undefined ? { ...previous, [id]: true } : previous);
  }, [snapshot?.activeProjectId]);
  const collapsed = !preferences.visible;
  return {
    /** The width the navigation takes from the window: none while collapsed. */
    extent: collapsed ? 0 : preferences.width,
    toggle: <button aria-label={collapsed ? t('expandNavigation') : t('collapseNavigation')} aria-expanded={!collapsed} disabled={!snapshot} onClick={toggle}>☷</button>,
    sidebar: <nav className={`navigation ${collapsed ? 'collapsed' : ''}`} aria-label={t('projectNavigation')} style={{ '--navigation-width': `${preferences.width}px` } as CSSProperties}>
      <div className="navigation-projects"><div className="nav-heading">{t('projects')}</div>
        {snapshot?.projects.map(project => {
          const expanded = expandedProjects[project.id] ?? snapshot.activeProjectId === project.id;
          const active = page === 'workbench' && snapshot.activeProjectId === project.id;
          // The panel the user is on: the maximized one (resident or an open tray panel), else the selected one.
          const { selected, maximized } = host.view(project.id);
          const shown = active ? maximized ?? selected : undefined;
          const count = projectPanels(project).length;
          return <section key={project.id} className="project-group" data-project-id={project.id}>
            <ProjectNavigationItem project={project} openProject={host.openProject}>
              <button className="project-disclosure" aria-label={t(expanded ? 'collapseProject' : 'expandProject', { name: project.name })} aria-expanded={expanded} onClick={() => setExpandedProjects(previous => ({ ...previous, [project.id]: !expanded }))}>{expanded ? '⌄' : '›'}</button>
              <button data-hint={`${project.name} · ${t('panelCount', { count })}`} aria-label={project.name} aria-current={active ? 'page' : undefined} className={`project-link ${active ? 'selected' : ''}`} onClick={() => host.openProject(project.id)}><span className="project-initial" aria-hidden="true">{projectInitial(project.name)}</span><span className="project-name">{project.name}</span><small>{count}</small></button>
            </ProjectNavigationItem>
            {expanded && !!project.panels.length && <div className="project-panels" aria-label={t('projectPanels', { name: project.name })}>{project.panels.map(panel =>
              <PanelLink key={panel.id} panel={panel} current={shown === panel.id} locate={() => host.locatePanel(project.id, panel.id)} />)}</div>}
            {expanded && !!project.tray.length && <EphemeralGroup project={project} shownPanelId={shown}
              expanded={!!expandedTrays[project.id]} toggle={() => setExpandedTrays(previous => ({ ...previous, [project.id]: !previous[project.id] }))}
              locate={panelId => host.locatePanel(project.id, panelId)} />}
          </section>;
        })}
        <button className={`add-project ${page === 'setup' ? 'selected' : ''}`} aria-label={t('addProject')} aria-current={page === 'setup' ? 'page' : undefined} onClick={host.createProject}><span>＋</span>{t('addProject')}</button>
      </div>
      <div className="nav-footer"><span>{t('localWorkbench')}</span><button className={`settings-entry ${page === 'settings' ? 'selected' : ''}`} aria-label={t('settings')} aria-current={page === 'settings' ? 'page' : undefined} disabled={!snapshot} onClick={host.toggleSettings}>⚙</button></div>
      <div className="navigation-resize" role="separator" aria-label={t('resizeNavigation')} aria-orientation="vertical" onPointerDown={resize} />
    </nav>,
  };
}

function PanelLink({ panel, current, locate }: { panel: PanelView; current: boolean; locate(): void }) {
  const { t } = useLocalization();
  const title = panel.run?.title ?? t('untitled');
  const { status } = panel;
  const label = status ? `${t(status)} · ${title}` : title;
  return <button data-locate-panel-id={panel.id} data-hint={label} aria-label={label} aria-current={current ? 'true' : undefined} className={`panel-link ${panel.agent} ${current ? 'selected' : ''}`} onClick={locate}><span className="agent-symbols"><ProcessingStatusIcon state={status} /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span><span className="session-title">{title}</span></button>;
}

const attentionStates: ProcessingState[] = ['needs-input', 'done', 'error'];

/** A project's ephemeral panels below its resident panels. While collapsed, it shows which
 * states needing attention its panels are in; it has no add entry. */
function EphemeralGroup({ project, shownPanelId, expanded, toggle, locate }: {
  project: ProjectView; shownPanelId?: string; expanded: boolean; toggle(): void; locate(panelId: string): void;
}) {
  const { t } = useLocalization();
  const attention = attentionStates.filter(state => project.tray.some(panel => panel.status === state));
  const heading = t('ephemeralGroup', { count: project.tray.length });
  const label = !expanded && attention.length ? t('ephemeralGroupAttention', { group: heading, states: attention.map(state => t(state)) }) : heading;
  return <div className="ephemeral-group">
    <button className="ephemeral-toggle" aria-expanded={expanded} aria-label={label} data-hint={label} onClick={toggle}>
      <span className="ephemeral-disclosure" aria-hidden="true">{expanded ? '⌄' : '›'}</span><span className="ephemeral-heading">{heading}</span>
      {!expanded && <span className="ephemeral-attention">{attention.map(state => <ProcessingStatusIcon key={state} state={state} />)}</span>}
    </button>
    {expanded && <div className="project-panels" role="group" aria-label={t('ephemeralPanels', { name: project.name })}>{project.tray.map(panel =>
      <PanelLink key={panel.id} panel={panel} current={shownPanelId === panel.id} locate={() => locate(panel.id)} />)}</div>}
  </div>;
}
