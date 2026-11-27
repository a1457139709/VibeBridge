import type { Language, Layout, ProjectView } from '../../shared/model';
import type { Divider } from '../../shared/layout';
import { capturePointer } from '../common/pointer-capture';
import { createDragPreview } from './panel-drag';
import { fitPanel } from './panel-measurement';
import { createResizePreview } from './panel-resize';

export interface PanelGestureContext {
  canvas: HTMLElement;
  project: ProjectView;
  shownLayout: Layout | null;
  trayElement: HTMLElement | null;
  language: Language;
  visible: boolean;
  maximizedPanelId: string | undefined;
  present(layout: Layout | null): void;
  holdShownLayout(base: string | undefined): void;
  commitLayout(layout: Layout): void;
  placeInLayout(panelId: string, layout: Layout): void;
  moveToTray(panelId: string): void;
}

interface Saved {
  layoutKey: string;
  layout: Layout | null;
  panels: string;
  tray: string;
}

interface Gesture {
  kind: 'drag' | 'resize';
  context: PanelGestureContext;
  base: string;
  bounds: DOMRect;
  saved: Saved;
  frame: number | undefined;
  cancel(): void;
}

const savedOf = (project: ProjectView): Saved => ({
  layoutKey: JSON.stringify(project.layout),
  layout: project.layout,
  panels: JSON.stringify(project.panels.map(panel => [panel.id, panel.agent])),
  tray: JSON.stringify(project.tray.map(panel => panel.id)),
});

const residentPanels = (project: ProjectView) =>
  project.panels.map(({ id, agent, run }) => ({ id, agent, runId: run?.id }));

function fitResidentPanels({ canvas, project }: PanelGestureContext) {
  for (const panel of residentPanels(project)) {
    const element = canvas.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(panel.id)}"] .agent-panel`);
    if (element) fitPanel(element, panel.runId);
  }
}

function areaChanged({ context: { canvas, maximizedPanelId }, bounds }: Gesture) {
  const after = canvas.getBoundingClientRect();
  return (
    !canvas.isConnected ||
    !canvas.getClientRects().length ||
    bounds.x !== after.x ||
    bounds.y !== after.y ||
    bounds.width !== after.width ||
    bounds.height !== after.height ||
    canvas.dataset.maximizedPanelId !== maximizedPanelId
  );
}

export function createPanelGestures() {
  let active: Gesture | undefined;
  let suppressClick = false;
  const cancel = () => active?.cancel();
  const pointerAvailable = ({ canvas, visible }: PanelGestureContext, event: PointerEvent) =>
    !active && visible && event.button === 0 && canvas.isConnected && !!canvas.getClientRects().length;
  const available = (context: PanelGestureContext, event: PointerEvent) =>
    pointerAvailable(context, event) && !context.maximizedPanelId && !!context.shownLayout;
  const watch = (gesture: Gesture) => {
    gesture.frame = undefined;
    if (areaChanged(gesture)) gesture.cancel();
    if (active === gesture) gesture.frame = requestAnimationFrame(() => watch(gesture));
  };
  const track = <T>(
    kind: 'drag' | 'resize',
    context: PanelGestureContext,
    event: PointerEvent,
    handle: HTMLElement,
    preview: {
      move(event: PointerEvent): void;
      result(event: PointerEvent): T | undefined;
      dispose(): void;
    },
    commit: (result: T) => void,
  ) => {
    const base = JSON.stringify(context.shownLayout);
    const gesture: Gesture = {
      kind,
      context,
      base,
      bounds: context.canvas.getBoundingClientRect(),
      frame: undefined,
      saved: savedOf(context.project),
      cancel: () => {},
    };
    gesture.cancel = capturePointer(handle, event.pointerId, {
      move(pointer) {
        if (areaChanged(gesture)) gesture.cancel();
        else preview.move(pointer);
      },
      finish(committed, release) {
        const next = committed && release && !areaChanged(gesture) ? preview.result(release) : undefined;
        active = undefined;
        if (gesture.frame !== undefined) cancelAnimationFrame(gesture.frame);
        gesture.frame = undefined;
        preview.dispose();
        context.canvas.classList.remove('resizing');
        context.holdShownLayout(undefined);
        if (next) commit(next);
        else if (kind === 'resize') context.present(gesture.saved.layout);
        fitResidentPanels(context);
      },
    });
    active = gesture;
    context.holdShownLayout(base);
    if (kind === 'resize') context.canvas.classList.add('resizing');
    gesture.frame = requestAnimationFrame(() => watch(gesture));
  };
  return {
    cancel,
    startDrag(context: PanelGestureContext, event: PointerEvent, handle: HTMLElement, panelId: string) {
      const control = event.target instanceof Element ? event.target.closest('button, [role="menu"]') : null;
      if (control && control !== handle) return;
      const panels = residentPanels(context.project);
      const resident = panels.find(panel => panel.id === panelId);
      const source = resident ?? context.project.tray.find(panel => panel.id === panelId);
      if (
        !source ||
        (resident
          ? !available(context, event)
          : !pointerAvailable(context, event) || panels.some(panel => panel.id === context.maximizedPanelId))
      )
        return;
      event.preventDefault();
      suppressClick = false;
      const preview = createDragPreview({
        event,
        canvas: context.canvas,
        source: { id: source.id, agent: source.agent },
        panels,
        layout: context.shownLayout,
        element: resident ? undefined : (handle.closest<HTMLElement>('.agent-panel') ?? handle),
        tray: context.trayElement,
        language: context.language,
        onDragStart: () => {
          suppressClick = true;
        },
      });
      track('drag', context, event, handle, preview, result => {
        if (result.kind === 'tray') context.moveToTray(panelId);
        else if (resident) {
          context.present(result.layout);
          context.commitLayout(result.layout);
        } else context.placeInLayout(panelId, result.layout);
      });
    },
    startResize(context: PanelGestureContext, event: PointerEvent, handle: HTMLElement, divider: Divider) {
      const layout = context.shownLayout;
      if (!available(context, event) || !layout) return;
      event.preventDefault();
      const preview = createResizePreview(context.canvas, layout, divider, event, context.present);
      if (preview)
        track('resize', context, event, handle, preview, next => {
          context.present(next);
          context.commitLayout(next);
        });
    },
    snapshotArrived(project: ProjectView | undefined) {
      const gesture = active;
      if (!gesture) return;
      if (!project) {
        gesture.cancel();
        return;
      }
      const saved = savedOf(project);
      const invalidated =
        (saved.layoutKey !== gesture.saved.layoutKey && saved.layoutKey !== gesture.base) ||
        saved.panels !== gesture.saved.panels ||
        saved.tray !== gesture.saved.tray;
      gesture.saved = saved;
      if (invalidated) gesture.cancel();
    },
    escape(event: KeyboardEvent) {
      if (active && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    },
    click(event: MouseEvent) {
      const target = event.target;
      if (
        suppressClick &&
        target instanceof Element &&
        (target.closest('.tray-card') || (target.closest('.panel-header') && !target.closest('button, [role="menu"]')))
      ) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
