import { useState } from 'react';
import { flushSync } from 'react-dom';
import type { ProjectView, Snapshot } from '../../shared/model';
import { localize } from '../../shared/localization/localization';
import type { ReportNotice } from '../common/Notices';
import { focusTerminal, terminalHasFocus } from './terminals';
import { errorMessage } from '../../shared/caught-error';

interface View {
  selected?: string;
  maximized?: string;
}
interface Host {
  snapshot?: Snapshot;
  activateProject(projectId: string): Promise<void>;
  showWorkbench(): void;
  report: ReportNotice;
}
interface Views {
  view(projectId: string): View;
  changeView(projectId: string, change: (view: View) => View): void;
}
interface Navigation extends Views {
  activateProject(projectId: string): Promise<void>;
  showWorkbench(): void;
  report: ReportNotice;
}
interface LocateOperation {
  projectId: string;
  panelId?: string;
  runId?: string;
  stage: 'outgoing' | 'activating' | 'presenting' | 'entering';
  changingMaximized: boolean;
  animated: boolean;
  animationDone: boolean;
  focusSettled: boolean;
  report: ReportNotice;
}

const inTray = (project: ProjectView | undefined, id?: string) => !!project?.tray.some(panel => panel.id === id);
const resident = (project: ProjectView | undefined, id?: string) => !!project?.panels.some(panel => panel.id === id);
const inputTarget = (view: View) => view.maximized ?? view.selected;
function validView(project: ProjectView | undefined, view?: View): View {
  return {
    selected: resident(project, view?.selected) ? view?.selected : project?.panels[0]?.id,
    maximized: resident(project, view?.maximized) || inTray(project, view?.maximized) ? view?.maximized : undefined,
  };
}
const sameView = (a: View, b: View) => a.selected === b.selected && a.maximized === b.maximized;

function validViews(views: Record<string, View>, snapshot: Snapshot) {
  let changed = false;
  const valid: Record<string, View> = {};
  for (const [id, saved] of Object.entries(views)) {
    const project = snapshot.projects.find(item => item.id === id);
    if (!project) {
      changed = true;
      continue;
    }
    valid[id] = validView(project, saved);
    if (!sameView(saved, valid[id])) changed = true;
  }
  return changed ? valid : views;
}

const inputTargetIn = (canvas: HTMLElement) =>
  canvas.querySelector<HTMLElement>('[data-input-target]')?.dataset.panelId;

function createLocator(showLocating: (locating: boolean) => void) {
  let snapshot: Snapshot | undefined;
  let current: LocateOperation | undefined;
  let canvas: HTMLElement | undefined;
  let animation: Animation | undefined;
  let animatedElement: HTMLElement | undefined;
  let frame: number | undefined;
  let suspended = false;
  let focusProjectId: string | undefined;
  let focusedKey: string | undefined;
  let focusing = false;
  let focusBlocked = false;
  const project = (id?: string | null) => snapshot?.projects.find(item => item.id === id);
  const panel = (projectId: string, panelId?: string) => {
    const item = project(projectId);
    return item?.panels.find(panel => panel.id === panelId) ?? item?.tray.find(panel => panel.id === panelId);
  };
  const runningId = (projectId: string, panelId?: string) => {
    const run = panel(projectId, panelId)?.run;
    return run?.state === 'running' ? run.id : undefined;
  };
  const focusKey = (projectId: string, panelId?: string) =>
    JSON.stringify([projectId, panelId, runningId(projectId, panelId)]);
  function cancel() {
    current = undefined;
    animation?.cancel();
    animation = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    showLocating(false);
  }
  function targetExists(projectId: string, panelId?: string, runId?: string) {
    return (
      !!project(projectId) &&
      (!panelId || !!panel(projectId, panelId)) &&
      (!runId || runningId(projectId, panelId) === runId)
    );
  }
  function blurCanvas() {
    if (document.activeElement instanceof HTMLElement && canvas?.contains(document.activeElement))
      document.activeElement.blur();
  }
  function rejectTarget() {
    cancel();
    focusBlocked = true;
    focusedKey = undefined;
    blurCanvas();
  }
  function claimFocus(projectId: string) {
    cancel();
    focusProjectId = projectId;
    focusBlocked = false;
  }
  function schedule() {
    if (!suspended && frame === undefined) frame = requestAnimationFrame(advanceLocate);
  }
  function usableCanvas() {
    if (
      suspended ||
      !canvas ||
      !canvas.isConnected ||
      !canvas.checkVisibility() ||
      canvas.dataset.projectId !== snapshot?.activeProjectId
    )
      return;
    return canvas;
  }
  function focus(projectId: string, panelId?: string) {
    const runId = runningId(projectId, panelId);
    focusing = true;
    try {
      if (runId) return focusTerminal(runId);
      blurCanvas();
      return true;
    } finally {
      focusing = false;
    }
  }
  function focusInputTarget(projectId: string) {
    if (canvas?.dataset.projectId !== projectId) return;
    const target = inputTargetIn(canvas);
    if (focus(projectId, target)) focusedKey = focusKey(projectId, target);
  }
  async function animate(element: HTMLElement, entering: boolean) {
    if (!element.animate) return false;
    let own: Animation | undefined;
    try {
      const frames = [
        { transform: 'scale(1)', opacity: 1 },
        { transform: 'scale(.96)', opacity: 0.3 },
      ];
      own = element.animate(entering ? frames.reverse() : frames, {
        duration: 100,
        easing: 'ease-in-out',
        fill: 'both',
      });
      animation = own;
      animatedElement = element;
      await own.finished;
      return true;
    } catch {
      return false;
    } finally {
      own?.cancel();
      if (animation === own) animation = undefined;
    }
  }
  function complete(operation: LocateOperation) {
    if (
      current !== operation ||
      !operation.focusSettled ||
      !operation.animationDone ||
      usableCanvas()?.dataset.projectId !== operation.projectId
    )
      return;
    if (operation.changingMaximized && !operation.animated) {
      const target = panel(operation.projectId, operation.panelId);
      if (target) {
        const { t } = localize(snapshot?.settings.language ?? 'en');
        operation.report(t('locatedPanel', { title: target.run?.title ?? t('untitled') }), 'success');
      }
    }
    current = undefined;
    showLocating(false);
  }
  function advanceLocate() {
    frame = undefined;
    const area = usableCanvas();
    const projectId = area?.dataset.projectId;
    if (focusBlocked || !area || !projectId || projectId !== focusProjectId) return;
    const operation = current;
    if (
      operation &&
      (operation.projectId !== projectId || operation.stage === 'outgoing' || operation.stage === 'activating')
    )
      return;
    const active = document.activeElement;
    if (
      !operation &&
      focusedKey !== undefined &&
      active !== document.body &&
      active !== document.documentElement &&
      !terminalHasFocus()
    )
      return;
    const target = inputTargetIn(area);
    const key = focusKey(projectId, target);
    if (focusedKey !== key || (operation && !operation.focusSettled)) {
      if (focus(projectId, target)) {
        focusedKey = key;
        if (operation) operation.focusSettled = true;
      } else schedule();
    }
    if (!operation) return;
    if (operation.stage === 'presenting') {
      operation.stage = 'entering';
      if (operation.animated) {
        void animate(area, true).then(animated => {
          if (current !== operation) return;
          operation.animated = animated;
          operation.animationDone = true;
          complete(operation);
        });
      } else operation.animationDone = true;
    }
    complete(operation);
  }
  async function open(navigation: Navigation, projectId: string, panelId?: string, runId?: string) {
    const target = project(projectId);
    if (!target || !targetExists(projectId, panelId, runId)) {
      rejectTarget();
      return;
    }
    const sourceProject = project(snapshot?.activeProjectId);
    const sourceView = sourceProject ? navigation.view(sourceProject.id) : {};
    const changingMaximized =
      !!panelId &&
      !!sourceView.maximized &&
      (snapshot?.activeProjectId !== projectId || sourceView.maximized !== panelId);
    claimFocus(projectId);
    focusedKey = undefined;
    const operation: LocateOperation = {
      projectId,
      panelId: panelId ?? inputTarget(navigation.view(projectId)),
      runId,
      stage: 'outgoing',
      changingMaximized,
      animated: changingMaximized && !matchMedia('(prefers-reduced-motion: reduce)').matches,
      animationDone: false,
      focusSettled: false,
      report: navigation.report,
    };
    current = operation;
    showLocating(true);
    try {
      const source = usableCanvas();
      if (operation.animated) operation.animated = source ? await animate(source, false) : false;
      if (current !== operation) return;
      if (panelId && inTray(target, panelId))
        navigation.changeView(projectId, view => ({ ...view, maximized: panelId }));
      else if (panelId)
        navigation.changeView(projectId, () => ({
          selected: panelId,
          maximized: resident(sourceProject, sourceView.maximized) ? panelId : undefined,
        }));
      suspended = false;
      navigation.showWorkbench();
      operation.stage = 'activating';
      await navigation.activateProject(projectId);
      if (current !== operation) return;
      operation.stage = 'presenting';
      schedule();
    } catch (error) {
      if (current === operation) {
        cancel();
        navigation.report(errorMessage(error));
      }
    }
  }
  function applyPanelAction(
    views: Views,
    projectId: string,
    panelId: string,
    action: 'select' | 'focus' | 'toggleMaximize' = 'select',
  ) {
    const target = project(projectId);
    const ephemeral = inTray(target, panelId);
    if (suspended || snapshot?.activeProjectId !== projectId || !(resident(target, panelId) || ephemeral)) return;
    claimFocus(projectId);
    const previous = views.view(projectId);
    if (action !== 'select' || inputTarget(previous) !== panelId) focusedKey = undefined;
    const maximized =
      action === 'toggleMaximize' ? (previous.maximized === panelId ? undefined : panelId) : previous.maximized;
    const next = { selected: ephemeral ? previous.selected : panelId, maximized };
    if (action === 'select') views.changeView(projectId, () => next);
    else {
      flushSync(() => views.changeView(projectId, () => next));
      focusInputTarget(projectId);
    }
    schedule();
    return true;
  }
  return {
    received(next: Snapshot) {
      snapshot = next;
      if (current && !targetExists(current.projectId, current.panelId, current.runId)) rejectTarget();
      if (!project(focusProjectId)) focusProjectId = next.activeProjectId ?? undefined;
      schedule();
    },
    open,
    leaveWorkbench(changePage: () => void) {
      cancel();
      suspended = true;
      focusedKey = undefined;
      changePage();
    },
    returnToWorkbench(changePage: () => void) {
      changePage();
      if (!suspended) return;
      suspended = false;
      if (!current) focusProjectId = snapshot?.activeProjectId ?? undefined;
      schedule();
    },
    connect(element: HTMLElement) {
      canvas = element;
      schedule();
      return () => {
        if (canvas !== element) return;
        if (animatedElement === element) animation?.cancel();
        canvas = undefined;
        focusedKey = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
      };
    },
    applyPanelAction,
    selectFocusedPanel(views: Views, projectId: string, panelId: string) {
      if (!focusing && applyPanelAction(views, projectId, panelId)) focusedKey = focusKey(projectId, panelId);
    },
    collapse(views: Views, projectId: string) {
      const open = views.view(projectId).maximized;
      if (open && inTray(project(projectId), open)) applyPanelAction(views, projectId, open, 'toggleMaximize');
    },
    reopen(views: Views, projectId: string, panelId: string) {
      if (suspended || snapshot?.activeProjectId !== projectId || !inTray(project(projectId), panelId)) return;
      let reopened = false;
      flushSync(() =>
        views.changeView(projectId, view => {
          if (view.maximized) return view;
          reopened = true;
          return { ...view, maximized: panelId };
        }),
      );
      if (!reopened) return;
      claimFocus(projectId);
      focusedKey = undefined;
      focusInputTarget(projectId);
      schedule();
    },
    openAddedPanel(views: Views, projectId: string, panelId: string) {
      if (suspended || snapshot?.activeProjectId !== projectId) return;
      claimFocus(projectId);
      focusedKey = undefined;
      views.changeView(projectId, view => ({ selected: view.selected, maximized: panelId }));
      schedule();
    },
  };
}

const workspaceConnection = Symbol('workspaceConnection');

export function usePanelLocation(host: Host) {
  const [views, setViews] = useState<Record<string, View>>({});
  const [locating, setLocating] = useState(false);
  const [locator] = useState(() => createLocator(setLocating));
  const project = (id: string) => host.snapshot?.projects.find(item => item.id === id);
  const viewsOf: Views = {
    view: projectId => validView(project(projectId), views[projectId]),
    changeView(projectId, change) {
      setViews(previous => {
        const before = validView(project(projectId), previous[projectId]);
        const next = change(before);
        return sameView(before, next) ? previous : { ...previous, [projectId]: next };
      });
    },
  };
  const navigation: Navigation = {
    ...viewsOf,
    activateProject: host.activateProject,
    showWorkbench: host.showWorkbench,
    report: host.report,
  };
  return {
    view: viewsOf.view,
    locating,
    received(snapshot: Snapshot) {
      setViews(previous => validViews(previous, snapshot));
      locator.received(snapshot);
    },
    openProject: (id: string) => {
      void locator.open(navigation, id);
    },
    locatePanel: (projectId: string, panelId: string, runId?: string) => {
      void locator.open(navigation, projectId, panelId, runId);
    },
    leaveWorkbench: locator.leaveWorkbench,
    returnToWorkbench: locator.returnToWorkbench,
    [workspaceConnection]: { locator, views: viewsOf },
  };
}
export type PanelLocation = ReturnType<typeof usePanelLocation>;

export function useWorkspacePanelLocation(location: PanelLocation, project: ProjectView, order: string[]) {
  const view = location.view(project.id);
  const { locator, views } = location[workspaceConnection];
  return {
    ...view,
    connectCanvas: locator.connect,
    select: (panelId: string) => locator.applyPanelAction(views, project.id, panelId),
    focus: (panelId: string) => locator.applyPanelAction(views, project.id, panelId, 'focus'),
    selectFocusedPanel: (panelId: string) => locator.selectFocusedPanel(views, project.id, panelId),
    toggleMaximize: (panelId: string) => locator.applyPanelAction(views, project.id, panelId, 'toggleMaximize'),
    openTrayPanel: (panelId: string) => {
      if (view.maximized !== panelId) locator.applyPanelAction(views, project.id, panelId, 'toggleMaximize');
    },
    collapse: () => locator.collapse(views, project.id),
    reopen: (panelId: string) => locator.reopen(views, project.id, panelId),
    openAddedPanel: (panelId: string) => locator.openAddedPanel(views, project.id, panelId),
    move(offset: -1 | 1) {
      if (!view.selected || !order.length) return;
      location.locatePanel(project.id, order[(order.indexOf(view.selected) + offset + order.length) % order.length]);
    },
  };
}
