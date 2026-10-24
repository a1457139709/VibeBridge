import { useLocalization } from './Localization';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { DesktopAPI } from '../shared/api';
import { defaultNavigation, navigationWidth, type NavigationPreferences, type Snapshot } from '../shared/model';
import { sessionTitle } from '../shared/session-title';
import { agentIcons } from './agent-icons';
import type { PanelLocation } from './panel-location';
import { capturePointer } from './pointer-capture';
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
export function useProjectNavigation(host: Host, api: Pick<DesktopAPI, 'saveNavigation' | 'subscribe'> = window.workbench) {
  const { t } = useLocalization();
  const { snapshot, page } = host;
  const [preferences, setPreferences] = useState(defaultNavigation);
  const confirmed = useRef(defaultNavigation);
  const knownSaved = useRef(defaultNavigation);
  const initialized = useRef(false);
  const pending = useRef<object | undefined>(undefined);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const id = snapshot?.activeProjectId;
    if (id) setExpandedProjects(previous => previous[id] === undefined ? { ...previous, [id]: true } : previous);
  }, [snapshot?.activeProjectId]);
  useLayoutEffect(() => {
    if (snapshot && !initialized.current) {
      initialized.current = true;
      confirmed.current = knownSaved.current = snapshot.navigation;
      setPreferences(snapshot.navigation);
    }
  }, [snapshot]);
  useLayoutEffect(() => {
    // Observe navigation at delivery time, independently of React's batching of
    // App snapshots. Old writes remain known for failure recovery, but cannot
    // become the base of another operation or replace its preview while pending.
    const unsubscribe = api.subscribe(event => {
      if (event.kind !== 'snapshot') return;
      initialized.current = true;
      knownSaved.current = event.snapshot.navigation;
      if (!pending.current) {
        confirmed.current = knownSaved.current;
        setPreferences(confirmed.current);
      }
    });
    return () => { unsubscribe(); pending.current = undefined; cancelResize.current?.(); };
  }, [api]);

  function replaceOperation() {
    const operation = {};
    pending.current = operation;
    cancelResize.current?.();
    return operation;
  }
  function save(operation: object, next: NavigationPreferences) {
    void api.saveNavigation(next).then(() => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current = next;
      setPreferences(next);
    }).catch(error => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current;
      setPreferences(confirmed.current);
      host.report(error.message);
    });
  }
  function toggle() {
    if (!snapshot) return;
    const next = { ...confirmed.current, visible: !preferences.visible };
    const operation = replaceOperation();
    setPreferences(next);
    save(operation, next);
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!snapshot || event.button !== 0) return;
    event.preventDefault();
    const operation = replaceOperation();
    const base = confirmed.current;
    const element = event.currentTarget, start = event.clientX;
    const width = element.parentElement!.getBoundingClientRect().width;
    let next = navigationWidth(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = navigationWidth(width + pointer.clientX - start);
      setPreferences({ ...base, width: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel); cancelResize.current = undefined;
      if (pending.current !== operation) return;
      if (commit) save(operation, { ...base, width: next });
      else {
        pending.current = undefined;
        confirmed.current = knownSaved.current;
        setPreferences(confirmed.current);
      }
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }

  const collapsed = !preferences.visible;
  return {
    toggle: <button aria-label={collapsed ? t('expandNavigation') : t('collapseNavigation')} aria-expanded={!collapsed} disabled={!snapshot} onClick={toggle}>☷</button>,
    sidebar: <nav className={`navigation ${collapsed ? 'collapsed' : ''}`} aria-label={t('projectNavigation')} style={{ '--navigation-width': `${preferences.width}px` } as CSSProperties}>
      <div className="navigation-projects"><div className="nav-heading">{t('projects')}</div>
        {snapshot?.projects.map(project => {
          const expanded = expandedProjects[project.id] ?? snapshot.activeProjectId === project.id;
          const selected = host.view(project.id).selected;
          const active = page === 'workbench' && snapshot.activeProjectId === project.id;
          return <section key={project.id} className="project-group" data-project-id={project.id}>
            <ProjectNavigationItem project={project} runs={snapshot.runs} openProject={host.openProject}>
              <button className="project-disclosure" aria-label={t(expanded ? 'collapseProject' : 'expandProject', { name: project.name })} aria-expanded={expanded} onClick={() => setExpandedProjects(previous => ({ ...previous, [project.id]: !expanded }))}>{expanded ? '⌄' : '›'}</button>
              <button title={`${project.name} · ${t('panelCount', { count: project.panels.length })}`} aria-label={project.name} aria-current={active ? 'page' : undefined} className={`project-link ${active ? 'selected' : ''}`} onClick={() => host.openProject(project.id)}><span className="project-initial" aria-hidden="true">{projectInitial(project.name)}</span><span className="project-name">{project.name}</span><small>{project.panels.length}</small></button>
            </ProjectNavigationItem>
            {expanded && !!project.panels.length && <div className="project-panels" aria-label={t('projectPanels', { name: project.name })}>{project.panels.map(panel => {
              const run = snapshot.runs.find(run => run.panelId === panel.id);
              const title = sessionTitle(panel.agent, run?.rawTitle, t('untitled'));
              const status = run && snapshot.processing.runs[run.id];
              const current = active && selected === panel.id;
              return <button key={panel.id} data-locate-panel-id={panel.id} title={status ? `${t(status)} · ${title}` : title} aria-label={status ? `${t(status)} · ${title}` : title} aria-current={current ? 'true' : undefined} className={`panel-link ${panel.agent} ${current ? 'selected' : ''}`} onClick={() => host.locatePanel(project.id, panel.id)}><span className="agent-symbols"><ProcessingStatusIcon state={status} /><span className="agent-mark" aria-hidden="true">{agentIcons[panel.agent]}</span></span><span className="session-title">{title}</span></button>;
            })}</div>}
          </section>;
        })}
        <button className={`add-project ${page === 'setup' ? 'selected' : ''}`} aria-label={t('addProject')} aria-current={page === 'setup' ? 'page' : undefined} onClick={host.createProject}><span>＋</span>{t('addProject')}</button>
      </div>
      <div className="nav-footer"><span>{t('localWorkbench')}</span><button className={`settings-entry ${page === 'settings' ? 'selected' : ''}`} aria-label={t('settings')} aria-current={page === 'settings' ? 'page' : undefined} disabled={!snapshot} onClick={host.toggleSettings}>⚙</button></div>
      <div className="navigation-resize" role="separator" aria-label={t('resizeNavigation')} aria-orientation="vertical" onPointerDown={resize} />
    </nav>,
  };
}
