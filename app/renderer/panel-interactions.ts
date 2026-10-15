import type { Layout, Panel } from '../shared/model';
import type { Divider } from '../shared/layout';
import { capturePointer } from './pointer-capture';
import { createSwapPreview } from './panel-swap';
import { measurePanel } from './panel-measurement';
import { createResizePreview } from './panel-resize';

export interface PanelInteractionContext {
  projectId: string;
  // The latest saved layout, never the temporary layout emitted by presentLayout.
  layout: Layout | null;
  panels: (Panel & { runId?: string })[];
  visible: boolean;
  maximizedPanelId?: string;
  presentLayout(layout: Layout | null): void;
  commitLayout(layout: Layout): void;
}

// Update after each DOM commit (including title/run changes). The module owns
// observation; the caller only renders layouts and persists valid commits.
export function createPanelInteractions(canvas: HTMLElement, context: PanelInteractionContext) {
  let current = context;
  let displayed = context.layout;
  let layoutKey = JSON.stringify(context.layout);
  let disposed = false, suppressClick = false;
  let active: { kind: 'swap' | 'resize'; cancel(): void; bounds: DOMRect } | undefined;
  let frame: number | undefined;
  const observed = new Map<string, { panel: HTMLElement; container: HTMLElement; runId?: string }>();
  const measure = () => {
    if (disposed || !current.visible || active?.kind === 'swap') return;
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
    if (suppressClick && target.closest('.panel-header') && !target.closest('button, [role="menu"]')) {
      suppressClick = false; event.preventDefault(); event.stopPropagation();
    }
  };
  window.addEventListener('blur', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('keydown', keydown, true);
  document.addEventListener('visibilitychange', hidden);
  canvas.addEventListener('click', click, true);
  // Ignore overlapping starts until the active pointer finishes or is cancelled.
  // In particular a second pointer must not take over the first pointer's capture.
  const available = (event: PointerEvent) => !disposed && !active && current.visible && !current.maximizedPanelId
    && displayed && event.button === 0 && canvas.isConnected && canvas.getClientRects().length;
  const track = (kind: 'swap' | 'resize', event: PointerEvent, handle: HTMLElement, preview: {
    move(event: PointerEvent): void;
    result(event: PointerEvent): Layout | undefined;
    dispose(): void;
  }) => {
    const bounds = canvas.getBoundingClientRect();
    const stop = capturePointer(handle, event.pointerId, {
      move(pointer) { if (geometryChanged()) cancel(); else preview.move(pointer); },
      finish(commit, release) {
        const next = commit && release && !geometryChanged() ? preview.result(release) : undefined;
        active = undefined;
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined; preview.dispose(); canvas.classList.remove('resizing');
        if (next) { present(next); current.commitLayout(next); }
        else if (kind === 'resize') present(current.layout);
        schedule();
      },
    });
    active = { kind, cancel: stop, bounds };
    if (kind === 'resize') canvas.classList.add('resizing');
    schedule();
  };
  const interactions = {
    update(next: PanelInteractionContext) {
      if (disposed) return;
      const nextKey = JSON.stringify(next.layout);
      const invalidated = current.projectId !== next.projectId || layoutKey !== nextKey
        || JSON.stringify(current.panels.map(panel => [panel.id, panel.agent])) !== JSON.stringify(next.panels.map(panel => [panel.id, panel.agent]))
        || !next.visible || current.maximizedPanelId !== next.maximizedPanelId;
      const changedLayout = current.projectId !== next.projectId || layoutKey !== nextKey;
      current = next; layoutKey = nextKey;
      if (invalidated) cancel();
      if (changedLayout) present(next.layout);
      syncPanels(); measure();
    },
    startSwap(event: PointerEvent, handle: HTMLElement, panelId: string) {
      if (!available(event) || !current.panels.some(panel => panel.id === panelId)
        || (event.target as HTMLElement).closest('button, [role="menu"]')) return;
      event.preventDefault(); suppressClick = false;
      const preview = createSwapPreview({ event, canvas, source: panelId, panels: current.panels, layout: displayed!,
        consumed: () => { suppressClick = true; } });
      track('swap', event, handle, preview);
    },
    startResize(event: PointerEvent, handle: HTMLElement, divider: Divider) {
      if (!available(event)) return;
      event.preventDefault();
      const preview = createResizePreview(canvas, displayed!, divider, event, present);
      if (preview) track('resize', event, handle, preview);
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
      canvas.removeEventListener('click', click, true);
    },
  };
  syncPanels(); measure();
  return interactions;
}
