import type { Language, Layout, Panel } from '../shared/model';
import type { Divider } from '../shared/layout';
import { capturePointer } from './pointer-capture';
import { createDragPreview } from './panel-drag';
import { measurePanel } from './panel-measurement';
import { createResizePreview } from './panel-resize';

export interface PanelInteractionContext {
  language?: Language;
  projectId: string;
  // The latest saved layout, never the temporary layout emitted by presentLayout.
  layout: Layout | null;
  // Resident panels.
  panels: (Panel & { runId?: string })[];
  // Tray panels in tray order, and the tray element a resident panel can be dropped on.
  tray: Panel[];
  trayElement: HTMLElement | null;
  visible: boolean;
  maximizedPanelId?: string;
  presentLayout(layout: Layout | null): void;
  commitLayout(layout: Layout): void;
  // Valid drops that change which panels are resident.
  placeInLayout(panelId: string, layout: Layout): void;
  moveToTray(panelId: string): void;
}

// Update after each DOM commit (including title/run changes). The module owns
// observation; the caller only renders layouts and persists valid commits.
export function createPanelInteractions(canvas: HTMLElement, context: PanelInteractionContext) {
  let current = context;
  let displayed = context.layout;
  let layoutKey = JSON.stringify(context.layout);
  let disposed = false, suppressClick = false;
  // `base` is the displayed layout the gesture was computed from; a saved layout equal to it leaves the gesture valid.
  let active: { kind: 'drag' | 'resize'; cancel(): void; bounds: DOMRect; base: string } | undefined;
  let frame: number | undefined;
  const observed = new Map<string, { panel: HTMLElement; container: HTMLElement; runId?: string }>();
  const measure = () => {
    if (disposed || !current.visible || active?.kind === 'drag') return;
    for (const binding of observed.values()) if (binding.container.isConnected) measurePanel(binding.container, binding.runId);
  };
  const present = (layout: Layout | null) => { displayed = layout; current.presentLayout(layout); };
  const cancel = () => active?.cancel();
  const geometryChanged = () => {
    if (!active) return false;
    const before = active.bounds, after = canvas.getBoundingClientRect();
    return !canvas.isConnected || !canvas.getClientRects().length || before.x !== after.x || before.y !== after.y
      || before.width !== after.width || before.height !== after.height;
  };
  const watchGeometry = () => {
    frame = undefined;
    if (geometryChanged()) cancel();
    measure();
    if (active) frame = requestAnimationFrame(watchGeometry);
  };
  const schedule = () => { if (frame === undefined && !disposed) frame = requestAnimationFrame(watchGeometry); };
  const observer = new ResizeObserver(() => { if (geometryChanged()) cancel(); measure(); });
  observer.observe(canvas);
  const syncPanels = () => {
    for (const [id, binding] of observed) {
      const panel = current.panels.find(panel => panel.id === id);
      if (!panel || panel.runId !== binding.runId || !canvas.contains(binding.container)) {
        observer.unobserve(binding.panel); observed.delete(id); cancel();
      }
    }
    for (const panel of current.panels) {
      if (observed.has(panel.id)) continue;
      const container = canvas.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"] .terminal-container`);
      if (!container) continue;
      const element = container.closest<HTMLElement>('.agent-panel')!;
      observed.set(panel.id, { panel: element, container, runId: panel.runId }); observer.observe(element);
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (active && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
  };
  const hidden = () => { if (document.hidden) cancel(); };
  const click = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (suppressClick && (target.closest('.tray-card') || target.closest('.panel-header') && !target.closest('button, [role="menu"]'))) {
      suppressClick = false; event.preventDefault(); event.stopPropagation();
    }
  };
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('keydown', keydown, true);
  document.addEventListener('visibilitychange', hidden);
  // A drag from a tray card ends with a click on the card, outside the canvas.
  document.addEventListener('click', click, true);
  // Ignore overlapping starts until the active pointer finishes or is cancelled.
  // In particular a second pointer must not take over the first pointer's capture.
  const pointerAvailable = (event: PointerEvent) => !disposed && !active && current.visible
    && event.button === 0 && canvas.isConnected && canvas.getClientRects().length;
  // Rearranging resident panels needs them on screen: nothing may be maximized.
  const available = (event: PointerEvent) => pointerAvailable(event) && !current.maximizedPanelId && displayed;
  const track = <T>(kind: 'drag' | 'resize', event: PointerEvent, handle: HTMLElement, preview: {
    move(event: PointerEvent): void;
    result(event: PointerEvent): T | undefined;
    dispose(): void;
  }, commit: (result: T) => void) => {
    const bounds = canvas.getBoundingClientRect();
    const stop = capturePointer(handle, event.pointerId, {
      move(pointer) { if (geometryChanged()) cancel(); else preview.move(pointer); },
      finish(released, release) {
        const next = released && release && !geometryChanged() ? preview.result(release) : undefined;
        active = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined; preview.dispose(); canvas.classList.remove('resizing');
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
      // A drop is shown before its save returns. When the saved layout becomes the one the active gesture
      // was computed from, the gesture and the displayed layout are still current.
      const changedLayout = (!sameProject || layoutKey !== nextKey) && !(sameProject && active?.base === nextKey);
      const invalidated = changedLayout
        || JSON.stringify(current.panels.map(panel => [panel.id, panel.agent])) !== JSON.stringify(next.panels.map(panel => [panel.id, panel.agent]))
        || JSON.stringify(current.tray.map(panel => panel.id)) !== JSON.stringify(next.tray.map(panel => panel.id))
        || !next.visible || current.maximizedPanelId !== next.maximizedPanelId;
      current = next; layoutKey = nextKey;
      if (invalidated) cancel();
      if (changedLayout) present(next.layout);
      syncPanels(); measure();
    },
    /**
     * Drags a resident panel by its header to another place in the layout or onto the tray, or a tray panel
     * by its card or open panel header into the layout. `handle` is the element the pointer went down on.
     */
    startDrag(event: PointerEvent, handle: HTMLElement, panelId: string) {
      const control = (event.target as HTMLElement).closest('button, [role="menu"]');
      if (control && control !== handle) return;
      const resident = current.panels.find(panel => panel.id === panelId);
      const ephemeral = current.tray.find(panel => panel.id === panelId);
      // A tray panel can be placed while it (or another tray panel) is open, but not over a maximized resident panel.
      if (resident ? !available(event) : !ephemeral || !pointerAvailable(event)
        || current.panels.some(panel => panel.id === current.maximizedPanelId)) return;
      event.preventDefault(); suppressClick = false;
      const preview = createDragPreview({ event, canvas, source: (resident ?? ephemeral)!, panels: current.panels, layout: displayed,
        element: resident ? undefined : handle.closest<HTMLElement>('.agent-panel') ?? handle, tray: current.trayElement,
        language: current.language,
        consumed: () => { suppressClick = true; } });
      track('drag', event, handle, preview, result => {
        if (result.kind === 'tray') current.moveToTray(panelId);
        else if (resident) { present(result.layout); current.commitLayout(result.layout); }
        else current.placeInLayout(panelId, result.layout);
      });
    },
    startResize(event: PointerEvent, handle: HTMLElement, divider: Divider) {
      if (!available(event)) return;
      event.preventDefault();
      const preview = createResizePreview(canvas, displayed!, divider, event, present);
      if (preview) track('resize', event, handle, preview, next => { present(next); current.commitLayout(next); });
    },
    cancel,
    dispose() {
      if (disposed) return;
      cancel(); disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect(); observed.clear();
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', keydown, true);
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('click', click, true);
    },
  };
  syncPanels(); measure();
  return interactions;
}
