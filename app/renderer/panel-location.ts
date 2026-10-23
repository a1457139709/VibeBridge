import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Project, Snapshot } from '../shared/model';
import { sessionTitle } from '../shared/session-title';
import { localize } from '../shared/localization';
import type { ReportNotice } from './Notices';
import { focusTerminal, terminalHasFocus } from './terminals';

interface View { selected?: string; maximized?: string }
interface Host {
  snapshot?: Snapshot;
  visible: boolean;
  activateProject(projectId: string): Promise<void>;
  showWorkbench(): void;
  report: ReportNotice;
}
interface Connection { projectId: string; canvas: HTMLElement; view: View }
interface Location {
  projectId: string;
  panelId?: string;
  runId?: string;
  stage: 'outgoing' | 'activating' | 'presenting' | 'entering';
  changingMaximized: boolean;
  animated: boolean;
  animationDone: boolean;
  focusSettled: boolean;
}

function validView(project: Project | undefined, view?: View): View {
  const contains = (id?: string) => project?.panels.some(panel => panel.id === id);
  return { selected: contains(view?.selected) ? view?.selected : project?.panels[0]?.id,
    maximized: contains(view?.maximized) ? view?.maximized : undefined };
}
const sameView = (a: View, b: View) => a.selected === b.selected && a.maximized === b.maximized;

// Private execution state shared by the two hooks. Workspace replacement only
// disconnects its DOM; the root retains the accepted operation and project views.
function createLocation(initial: Host, changed: () => void) {
  let host = initial;
  const views = new Map<string, View>();
  let current: Location | undefined;
  let connection: Connection | undefined;
  let animation: Animation | undefined;
  let frame: number | undefined;
  let disposed = false;
  let suspended = !host.visible;
  let focusProject = host.snapshot?.activeProjectId;
  let focusedKey: string | undefined;
  let focusing = false;
  let focusBlocked = false;
  const project = (id?: string | null) => host.snapshot?.projects.find(item => item.id === id);
  const view = (item?: Project) => validView(item, item && views.get(item.id));
  const focusKey = (projectId: string, panelId?: string) => JSON.stringify([projectId, panelId,
    host.snapshot?.runs.find(run => run.panelId === panelId && run.state === 'running')?.id]);
  const notify = () => { if (!disposed) changed(); };
  function cancel() {
    current = undefined;
    animation?.cancel(); animation = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    notify();
  }
  function targetExists(projectId: string, panelId?: string, runId?: string) {
    const target = project(projectId);
    return !!target && (!panelId || target.panels.some(panel => panel.id === panelId))
      && (!runId || host.snapshot?.runs.some(run => run.id === runId && run.panelId === panelId && run.projectId === projectId && run.state === 'running'));
  }
  function rejectTarget() {
    cancel(); focusBlocked = true; focusedKey = undefined;
    // A fallback view keeps the workspace usable, but is not an input target
    // authorized by the cancelled request. Wait for an explicit new selection.
    if (document.activeElement instanceof HTMLElement && connection?.canvas.contains(document.activeElement)) document.activeElement.blur();
  }
  function select(projectId: string, next: View) {
    if (sameView(view(project(projectId)), next)) return;
    views.set(projectId, next); notify();
  }
  function schedule() {
    if (!disposed && !suspended && frame === undefined) frame = requestAnimationFrame(progress);
  }
  function connected() {
    if (!host.visible || suspended || !connection || !connection.canvas.isConnected
      || !connection.canvas.checkVisibility() || host.snapshot?.activeProjectId !== connection.projectId) return;
    if (!sameView(connection.view, view(project(connection.projectId)))) return;
    return connection;
  }
  function focus(panelId?: string) {
    const run = host.snapshot?.runs.find(item => item.panelId === panelId && item.state === 'running');
    // focus() dispatches focus events synchronously. These are feedback, not a
    // user command replacing the operation that caused them.
    focusing = true;
    try {
      if (run) return focusTerminal(run.id);
      // The panel is displayed, but it has no input receiver. In particular a
      // keyboard command must not leave input going to the previous terminal.
      if (document.activeElement instanceof HTMLElement && connection?.canvas.contains(document.activeElement)) document.activeElement.blur();
      return true;
    }
    finally { focusing = false; }
  }
  async function animate(element: HTMLElement, entering: boolean) {
    if (!element.animate) return false;
    let own: Animation | undefined;
    try {
      const frames = [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.96)', opacity: .3 }];
      own = element.animate(entering ? frames.reverse() : frames, { duration: 100, easing: 'ease-in-out', fill: 'both' });
      animation = own;
      await own.finished;
      return true;
    } catch { return false; }
    finally { own?.cancel(); if (animation === own) animation = undefined; }
  }
  function complete(operation: Location) {
    if (current !== operation || !operation.focusSettled || !operation.animationDone
      || connected()?.projectId !== operation.projectId) return;
    if (operation.changingMaximized && !operation.animated) {
      const target = project(operation.projectId)?.panels.find(panel => panel.id === operation.panelId);
      if (target) {
        const { t } = localize(host.snapshot?.settings.language ?? 'en');
        host.report(t('locatedPanel', { title: sessionTitle(target.agent,
          host.snapshot?.runs.find(run => run.panelId === target.id)?.rawTitle, t('untitled')) }), 'success');
      }
    }
    current = undefined; notify();
  }
  function progress() {
    frame = undefined;
    const actual = connected();
    if (focusBlocked || !actual || actual.projectId !== focusProject) return;
    const operation = current;
    if (operation && (operation.projectId !== actual.projectId || operation.stage === 'outgoing' || operation.stage === 'activating')) return;
    const active = document.activeElement;
    // Snapshot changes may update the displayed selection while a control or
    // list owns the keyboard. Only an explicit location may take that focus.
    if (!operation && focusedKey !== undefined && active !== document.body && active !== document.documentElement && !terminalHasFocus()) return;
    const key = focusKey(actual.projectId, actual.view.selected);
    if (focusedKey !== key || (operation && !operation.focusSettled)) {
      if (focus(actual.view.selected)) { focusedKey = key; if (operation) operation.focusSettled = true; }
      else schedule();
    }
    if (!operation) return;
    if (operation.stage === 'presenting') {
      operation.stage = 'entering';
      if (operation.animated) {
        void animate(actual.canvas, true).then(animated => {
          if (current !== operation) return;
          operation.animated = animated; operation.animationDone = true; complete(operation);
        });
      } else operation.animationDone = true;
    }
    complete(operation);
  }
  async function open(projectId: string, panelId?: string, runId?: string) {
    if (disposed) return;
    const target = project(projectId);
    if (!target || !targetExists(projectId, panelId, runId)) { rejectTarget(); return; }
    const sourceView = view(project(host.snapshot?.activeProjectId));
    const changingMaximized = !!panelId && !!sourceView.maximized
      && (host.snapshot?.activeProjectId !== projectId || sourceView.maximized !== panelId);
    cancel();
    focusProject = projectId; focusedKey = undefined; focusBlocked = false;
    const operation: Location = { projectId, panelId: panelId ?? view(target).selected, runId, stage: 'outgoing', changingMaximized,
      animated: changingMaximized && !matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDone: false, focusSettled: false };
    current = operation; notify();
    try {
      const source = connected();
      if (operation.animated) operation.animated = source ? await animate(source.canvas, false) : false;
      if (current !== operation) return;
      if (panelId) select(projectId, { selected: panelId, maximized: sourceView.maximized ? panelId : undefined });
      suspended = false;
      host.showWorkbench();
      operation.stage = 'activating';
      // This IPC cannot be recalled. A late result may change the snapshot, but
      // only the still-current operation may schedule focus or report success.
      await host.activateProject(projectId);
      if (current !== operation) return;
      operation.stage = 'presenting'; schedule();
    } catch (error) {
      if (current === operation) { cancel(); host.report((error as Error).message); }
    }
  }
  function interact(projectId: string, panelId: string, intent: 'select' | 'focus' | 'maximize' = 'select') {
    const target = project(projectId);
    if (disposed || suspended || !host.visible || host.snapshot?.activeProjectId !== projectId
      || !target?.panels.some(panel => panel.id === panelId)) return;
    cancel(); focusProject = projectId; focusBlocked = false;
    const previous = view(target);
    if (intent !== 'select' || previous.selected !== panelId) focusedKey = undefined;
    select(projectId, { selected: panelId, maximized: intent === 'maximize' ? previous.maximized === panelId ? undefined : panelId : previous.maximized });
    // Header/maximize actions historically accept input immediately when their
    // terminal is already visible. Only an unmounted/hidden target needs a frame.
    if (intent !== 'select' && connection?.projectId === projectId && focus(panelId)) {
      focusedKey = focusKey(projectId, panelId);
    }
    schedule();
    return true;
  }
  return {
    view,
    get locating() { return !!current; },
    openProject: (id: string) => { void open(id); },
    locatePanel: (projectId: string, panelId: string, runId?: string) => { void open(projectId, panelId, runId); },
    leaveWorkbench(changePage: () => void) { cancel(); suspended = true; focusedKey = undefined; changePage(); },
    update(next: Host) {
      const wasVisible = host.visible;
      host = next;
      if (!host.visible && wasVisible) { cancel(); suspended = true; focusedKey = undefined; }
      if (host.visible && !wasVisible) { suspended = false; if (!current) focusProject = host.snapshot?.activeProjectId; }
      if (current && !targetExists(current.projectId, current.panelId, current.runId)) rejectTarget();
      for (const [id, saved] of views) {
        const item = project(id);
        if (!item) { views.delete(id); notify(); }
        else { const nextView = validView(item, saved); if (!sameView(saved, nextView)) { views.set(id, nextView); notify(); } }
      }
      if (!project(focusProject)) focusProject = host.snapshot?.activeProjectId;
      schedule();
    },
    connect(next: Connection) { connection = next; schedule(); },
    disconnect(canvas: HTMLElement) {
      if (connection?.canvas !== canvas) return;
      if (animation?.effect instanceof KeyframeEffect && animation.effect.target === canvas) animation.cancel();
      connection = undefined; focusedKey = undefined;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
    select: interact,
    focus: (projectId: string, panelId: string) => interact(projectId, panelId, 'focus'),
    focusChanged(projectId: string, panelId: string) {
      if (!focusing && interact(projectId, panelId)) focusedKey = focusKey(projectId, panelId);
    },
    toggleMaximize(projectId: string, panelId: string) { interact(projectId, panelId, 'maximize'); },
    panelAdded(projectId: string) {
      if (disposed || suspended || host.snapshot?.activeProjectId !== projectId) return;
      cancel(); focusProject = projectId; focusBlocked = false; select(projectId, { ...view(project(projectId)), maximized: undefined }); schedule();
    },
    mount() { disposed = false; },
    dispose() { disposed = true; cancel(); connection = undefined; },
  };
}

const workspaceConnection = Symbol('workspaceConnection');

export function usePanelLocation(host: Host) {
  const [, render] = useState(0);
  const [location] = useState(() => createLocation(host, () => render(value => value + 1)));
  useLayoutEffect(() => { location.mount(); return () => location.dispose(); }, [location]);
  useLayoutEffect(() => { location.update(host); });
  return {
    view: (projectId: string) => location.view(host.snapshot?.projects.find(project => project.id === projectId)),
    locating: location.locating,
    openProject: location.openProject,
    locatePanel: location.locatePanel,
    leaveWorkbench: location.leaveWorkbench,
    // Consumed only by the paired hook; callers pass the handle as a whole.
    [workspaceConnection]: location,
  };
}
export type PanelLocation = ReturnType<typeof usePanelLocation>;

export function useWorkspacePanelLocation(location: PanelLocation, project: Project, canvas: RefObject<HTMLElement | null>, order: string[]) {
  const view = location.view(project.id);
  const connection = location[workspaceConnection];
  const element = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    element.current = canvas.current;
    if (element.current) connection.connect({ projectId: project.id, canvas: element.current, view });
  });
  useLayoutEffect(() => () => { if (element.current) connection.disconnect(element.current); }, [connection]);
  return {
    ...view,
    select: (panelId: string) => connection.select(project.id, panelId),
    focus: (panelId: string) => connection.focus(project.id, panelId),
    focusChanged: (panelId: string) => connection.focusChanged(project.id, panelId),
    toggleMaximize: (panelId: string) => connection.toggleMaximize(project.id, panelId),
    panelAdded: () => connection.panelAdded(project.id),
    move(offset: -1 | 1) {
      if (!view.selected || !order.length) return;
      location.locatePanel(project.id, order[(order.indexOf(view.selected) + offset + order.length) % order.length]);
    },
  };
}
