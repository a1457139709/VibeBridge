import { useEffectEvent, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Language, Layout, Panel } from '../../shared/model';
import type { Divider } from '../../shared/layout';
import { capturePointer } from '../common/pointer-capture';
import { requireClosest, requireValue } from '../common/required';
import { createDragPreview } from './panel-drag';
import { applyCompactLayout } from './panel-measurement';
import { createResizePreview } from './panel-resize';

export interface PanelInteractionContext {
  language?: Language;
  projectId: string;
  layout: Layout | null;
  panels: (Panel & { runId?: string })[];
  tray: Panel[];
  trayElement: HTMLElement | null;
  visible: boolean;
  maximizedPanelId?: string;
  presentLayout(layout: Layout | null): void;
  commitLayout(layout: Layout): void;
  placeInLayout(panelId: string, layout: Layout): void;
  moveToTray(panelId: string): void;
}

export function createPanelInteractions(canvas: HTMLElement, context: PanelInteractionContext) {
  let current = context;
  let displayed = context.layout;
  let layoutKey = JSON.stringify(context.layout);
  let disposed = false,
    suppressClick = false;
  let active: { kind: 'drag' | 'resize'; cancel(): void; bounds: DOMRect; base: string } | undefined;
  let frame: number | undefined;
  const observed = new Map<string, { panel: HTMLElement; container: HTMLElement; runId?: string }>();
  const applyCompactLayouts = () => {
    if (disposed || !current.visible || active?.kind === 'drag') return;
    for (const observedPanel of observed.values())
      if (observedPanel.container.isConnected) applyCompactLayout(observedPanel.container, observedPanel.runId);
  };
  const present = (layout: Layout | null) => {
    displayed = layout;
    current.presentLayout(layout);
  };
  const cancel = () => active?.cancel();
  const geometryChanged = () => {
    if (!active) return false;
    const before = active.bounds,
      after = canvas.getBoundingClientRect();
    return (
      !canvas.isConnected ||
      !canvas.getClientRects().length ||
      before.x !== after.x ||
      before.y !== after.y ||
      before.width !== after.width ||
      before.height !== after.height
    );
  };
  const watchGeometry = () => {
    frame = undefined;
    if (geometryChanged()) cancel();
    applyCompactLayouts();
    if (active) frame = requestAnimationFrame(watchGeometry);
  };
  const schedule = () => {
    if (frame === undefined && !disposed) frame = requestAnimationFrame(watchGeometry);
  };
  const observer = new ResizeObserver(() => {
    if (geometryChanged()) cancel();
    applyCompactLayouts();
  });
  observer.observe(canvas);
  const syncPanels = () => {
    for (const [id, observedPanel] of observed) {
      const panel = current.panels.find(panel => panel.id === id);
      if (!panel || panel.runId !== observedPanel.runId || !canvas.contains(observedPanel.container)) {
        observer.unobserve(observedPanel.panel);
        observed.delete(id);
        cancel();
      }
    }
    for (const panel of current.panels) {
      if (observed.has(panel.id)) continue;
      const container = canvas.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"] .terminal-container`);
      if (!container) continue;
      const element = requireClosest(container, '.agent-panel');
      observed.set(panel.id, { panel: element, container, runId: panel.runId });
      observer.observe(element);
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (active && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
  };
  const hidden = () => {
    if (document.hidden) cancel();
  };
  const click = (event: MouseEvent) => {
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
  };
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('keydown', keydown, true);
  document.addEventListener('visibilitychange', hidden);
  document.addEventListener('click', click, true);
  const pointerAvailable = (event: PointerEvent) =>
    !disposed &&
    !active &&
    current.visible &&
    event.button === 0 &&
    canvas.isConnected &&
    canvas.getClientRects().length;
  const available = (event: PointerEvent) => pointerAvailable(event) && !current.maximizedPanelId && displayed;
  const track = <T>(
    kind: 'drag' | 'resize',
    event: PointerEvent,
    handle: HTMLElement,
    preview: {
      move(event: PointerEvent): void;
      result(event: PointerEvent): T | undefined;
      dispose(): void;
    },
    commit: (result: T) => void,
  ) => {
    const bounds = canvas.getBoundingClientRect();
    const stop = capturePointer(handle, event.pointerId, {
      move(pointer) {
        if (geometryChanged()) cancel();
        else preview.move(pointer);
      },
      finish(committed, upEvent) {
        const next = committed && upEvent && !geometryChanged() ? preview.result(upEvent) : undefined;
        active = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        preview.dispose();
        canvas.classList.remove('resizing');
        if (next) commit(next);
        else if (kind === 'resize') present(current.layout);
        schedule();
      },
    });
    active = { kind, cancel: stop, bounds, base: JSON.stringify(displayed) };
    if (kind === 'resize') canvas.classList.add('resizing');
    schedule();
  };
  const interactions = {
    update(next: PanelInteractionContext) {
      if (disposed) return;
      const nextKey = JSON.stringify(next.layout);
      const sameProject = current.projectId === next.projectId;
      const changedLayout = (!sameProject || layoutKey !== nextKey) && !(sameProject && active?.base === nextKey);
      const invalidated =
        changedLayout ||
        JSON.stringify(current.panels.map(panel => [panel.id, panel.agent])) !==
          JSON.stringify(next.panels.map(panel => [panel.id, panel.agent])) ||
        JSON.stringify(current.tray.map(panel => panel.id)) !== JSON.stringify(next.tray.map(panel => panel.id)) ||
        !next.visible ||
        current.maximizedPanelId !== next.maximizedPanelId;
      current = next;
      layoutKey = nextKey;
      if (invalidated) cancel();
      if (changedLayout) present(next.layout);
      syncPanels();
      applyCompactLayouts();
    },
    startDrag(event: PointerEvent, handle: HTMLElement, panelId: string) {
      const control = event.target instanceof Element ? event.target.closest('button, [role="menu"]') : null;
      if (control && control !== handle) return;
      const resident = current.panels.find(panel => panel.id === panelId);
      const source = resident ?? current.tray.find(panel => panel.id === panelId);
      if (
        !source ||
        (resident
          ? !available(event)
          : !pointerAvailable(event) || current.panels.some(panel => panel.id === current.maximizedPanelId))
      )
        return;
      event.preventDefault();
      suppressClick = false;
      const preview = createDragPreview({
        event,
        canvas,
        source,
        panels: current.panels,
        layout: displayed,
        element: resident ? undefined : (handle.closest<HTMLElement>('.agent-panel') ?? handle),
        tray: current.trayElement,
        language: current.language,
        onDragStart: () => {
          suppressClick = true;
        },
      });
      track('drag', event, handle, preview, result => {
        if (result.kind === 'tray') current.moveToTray(panelId);
        else if (resident) {
          present(result.layout);
          current.commitLayout(result.layout);
        } else current.placeInLayout(panelId, result.layout);
      });
    },
    startResize(event: PointerEvent, handle: HTMLElement, divider: Divider) {
      const layout = displayed;
      if (!available(event) || !layout) return;
      event.preventDefault();
      const preview = createResizePreview(canvas, layout, divider, event, present);
      if (preview)
        track('resize', event, handle, preview, next => {
          present(next);
          current.commitLayout(next);
        });
    },
    cancel,
    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      observed.clear();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', keydown, true);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('click', click, true);
    },
  };
  syncPanels();
  applyCompactLayouts();
  return interactions;
}

type PanelInteractions = ReturnType<typeof createPanelInteractions>;

export function usePanelInteractions(
  { canvas, tray }: { canvas: RefObject<HTMLElement | null>; tray: RefObject<HTMLElement | null> },
  context: Omit<PanelInteractionContext, 'trayElement'>,
) {
  const interactions = useRef<PanelInteractions | null>(null);
  const currentContext = useEffectEvent((): PanelInteractionContext => ({ ...context, trayElement: tray.current }));
  useLayoutEffect(() => {
    const created = createPanelInteractions(requireValue(canvas.current, 'the layout area'), currentContext());
    interactions.current = created;
    return () => {
      created.dispose();
      interactions.current = null;
    };
  }, [canvas]);
  useLayoutEffect(() => {
    interactions.current?.update(currentContext());
  });
  return {
    startDrag: (event: PointerEvent, handle: HTMLElement, panelId: string) =>
      interactions.current?.startDrag(event, handle, panelId),
    startResize: (event: PointerEvent, handle: HTMLElement, divider: Divider) =>
      interactions.current?.startResize(event, handle, divider),
  };
}
