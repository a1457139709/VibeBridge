import { agentNames, type Panel, type Layout, type Language } from '../shared/model';
import { dropIntoLayout, layoutBoxes, type Drop, type Side } from '../shared/layout';
import { localize } from '../shared/localization';

// The band along each edge of the layout area that fills that whole side: a fixed value, not a setting.
const edgeBand = 24;
const sideNames = { top: 'sideTop', bottom: 'sideBottom', left: 'sideLeft', right: 'sideRight' } as const;

// A frozen copy is only a paint surface. It never owns a terminal, input or a layout.
function snapshot(element: HTMLElement) {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.inert = true;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.querySelectorAll('textarea, input').forEach(node => node.remove());
  const originals = element.querySelectorAll('canvas');
  copy.querySelectorAll('canvas').forEach((canvas, index) => canvas.getContext('2d')?.drawImage(originals[index], 0, 0));
  const viewports = element.querySelectorAll<HTMLElement>('.xterm-viewport');
  copy.querySelectorAll<HTMLElement>('.xterm-viewport').forEach((viewport, index) => { viewport.scrollTop = viewports[index].scrollTop; });
  copy.style.height = '100%'; copy.style.width = '100%';
  return copy;
}

const inside = (box: DOMRect, x: number, y: number) => x >= box.left && x < box.right && y >= box.top && y < box.bottom;
const nearest = (box: DOMRect, x: number, y: number): Side => ([
  ['left', x - box.left], ['right', box.right - x], ['top', y - box.top], ['bottom', box.bottom - y],
] as const).reduce((best, edge) => edge[1] < best[1] ? edge : best)[0];

/**
 * Where a pointer drops a dragged panel. The edge band of the layout area fills that side; the middle third
 * (in width and in height) of another resident panel swaps with it; the rest of that panel splits it on
 * the edge nearest the pointer. Hit testing uses the areas from before the drag, never a displayed preview.
 */
export function dropAt(canvas: DOMRect, panels: { id: string; box: DOMRect }[], source: string, x: number, y: number): Drop | undefined {
  if (!inside(canvas, x, y)) return;
  const side = nearest(canvas, x, y);
  if ((side === 'left' ? x - canvas.left : side === 'right' ? canvas.right - x : side === 'top' ? y - canvas.top : canvas.bottom - y) < edgeBand)
    return { kind: 'fill', side };
  const target = panels.find(({ box }) => inside(box, x, y));
  if (!target || target.id === source) return;
  const { box } = target;
  const middle = (offset: number, size: number) => offset >= size / 3 && offset <= size * 2 / 3;
  return middle(x - box.left, box.width) && middle(y - box.top, box.height) ? { kind: 'swap', panel: target.id } : { kind: 'split', panel: target.id, side: nearest(box, x, y) };
}

/** What releasing a dragged panel does: the layout it produces, or (for a resident panel) moving it to the tray. */
export type DragResult = { kind: 'layout'; layout: Layout } | { kind: 'tray' };
// Where a dragged panel would land: in the layout, or (for a resident panel) on the tray.
type Target = Drop | { kind: 'tray' };

/**
 * Previews dragging a panel. A resident panel is dragged from its slot and can also be dropped on the tray.
 * A tray panel is dragged from `element` (its card or its open panel) and placed into the layout; with no
 * resident panels, dropping it anywhere in the layout area makes it the whole layout.
 */
export function createDragPreview({ event, canvas, source, element, panels, layout, tray, consumed, language = 'en' }: {
  event: PointerEvent; canvas: HTMLElement; source: Panel; panels: Panel[]; layout: Layout | null;
  /** The dragged tray panel's visible element; omitted for a resident panel. */
  element?: HTMLElement;
  /** The tray, a drop target for a resident panel. */
  tray?: HTMLElement | null;
  language?: Language;
  consumed(): void;
}) {
  const { t } = localize(language);
  const original = structuredClone(layout);
  const area = canvas.getBoundingClientRect();
  const images = panels.map(panel => {
    const slot = canvas.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"]`)!;
    const element = slot.querySelector<HTMLElement>('.agent-panel')!;
    return { panel, element, slot: slot.getBoundingClientRect(), box: element.getBoundingClientRect(), image: snapshot(element) };
  });
  const resident = images.find(image => image.panel.id === source.id);
  const dragged = resident ?? { panel: source, element: element!, box: element!.getBoundingClientRect(), image: snapshot(element!) };
  const agent = agentNames[source.agent];
  const trayArea = resident && tray ? tray.getBoundingClientRect() : undefined;
  // An empty tray lies over the bottom of the layout area (panel-tray.css); the layout's drops, edge band included, sit above it.
  const dropArea = trayArea?.height && trayArea.top > area.top && trayArea.top < area.bottom ? new DOMRect(area.x, area.y, area.width, trayArea.top - area.y) : area;
  // While a tray panel is placed, the open tray panel steps aside so every resident panel is a visible target.
  const covering = resident ? [] : [...canvas.querySelectorAll<HTMLElement>('.panel-slot')].filter(slot => !panels.some(panel => panel.id === slot.dataset.panelId));
  const offset = { x: event.clientX - dragged.box.x, y: event.clientY - dragged.box.y };
  let moving = false, drop: Target | undefined, next: DragResult | undefined;
  let ghost: HTMLDivElement | undefined, preview: HTMLDivElement | undefined, hidden: HTMLElement | undefined;
  // A labelled picture over the given window area.
  const figure = (className: string, label: string, box: { x: number; y: number; width: number; height: number }) => {
    const element = document.createElement('div'); element.className = className;
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', label);
    Object.assign(element.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    return element;
  };
  const layer = (image: HTMLElement, box: DOMRect, label: string, className: string) => {
    const wrapper = figure(className, label, box);
    wrapper.append(image); return wrapper;
  };
  const outline = (label: string, box: { x: number; y: number; width: number; height: number }) => figure(`panel-drop-preview ${source.agent}`, label, box);
  // The area the dragged panel takes in a layout, in window coordinates.
  const placed = (result: Layout) => {
    const box = layoutBoxes(result).panels.get(source.id)!;
    return { x: area.x + box.x * area.width, y: area.y + box.y * area.height, width: box.width * area.width, height: box.height * area.height };
  };
  const swapPreview = (target: string, result: Layout) => {
    const other = images.find(image => image.panel.id === target)!;
    const element = document.createElement('div'); element.className = 'panel-swap-preview';
    element.setAttribute('role', 'img'); element.setAttribute('aria-label', t('swapPreview', { first: agent, second: agentNames[other.panel.agent] }));
    hidden = other.element; hidden.classList.add('panel-drag-hidden');
    // A resident target moves into the dragged panel's slot; a target replaced by a tray panel leaves for the tray.
    element.append(resident ? layer(snapshot(other.image), dragged.box, agentNames[other.panel.agent], `panel-preview-image ${other.panel.agent}`)
      : outline(agent, placed(result)));
    return element;
  };
  // A drop preview outlines the area the dragged panel takes in the resulting layout.
  const dropPreview = (drop: Exclude<Drop, { kind: 'swap' }>, result: Layout) => outline(
    !original ? t('wholePreview', { agent })
      : drop.kind === 'fill' ? t('fillPreview', { agent, side: t(sideNames[drop.side]) })
        : t('splitPreview', { agent, side: t(sideNames[drop.side]), target: agentNames[images.find(image => image.panel.id === drop.panel)!.panel.agent] }),
    placed(result));
  const show = (candidate?: Target) => {
    if (JSON.stringify(candidate) === JSON.stringify(drop)) return;
    hidden?.classList.remove('panel-drag-hidden'); hidden = undefined;
    preview?.remove(); preview = undefined;
    drop = candidate; next = undefined;
    if (!drop) return;
    if (drop.kind === 'tray') {
      next = { kind: 'tray' };
      preview = outline(t('trayPreview', { agent }), trayArea!);
    } else {
      const result = dropIntoLayout(original, source.id, drop);
      // A drop that leaves the layout as it is (such as a lone panel filling a side) is not a valid drop.
      if (JSON.stringify(result) === JSON.stringify(original)) return;
      next = { kind: 'layout', layout: result };
      preview = drop.kind === 'swap' ? swapPreview(drop.panel, result) : dropPreview(drop, result);
    }
    document.body.append(preview);
  };
  const target = (x: number, y: number): Target | undefined => {
    if (trayArea && inside(trayArea, x, y)) return { kind: 'tray' };
    if (!original) return inside(area, x, y) ? { kind: 'fill', side: nearest(area, x, y) } : undefined;
    return dropAt(dropArea, images.map(image => ({ id: image.panel.id, box: image.slot })), source.id, x, y);
  };
  const move = (pointer: PointerEvent) => {
    if (!moving && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 5) return;
    if (!moving) {
      moving = true; consumed(); canvas.classList.add('dragging');
      if (!resident) canvas.classList.add('placing');
      for (const slot of covering) slot.classList.add('panel-drag-hidden');
      dragged.element.classList.add('panel-drag-hidden');
      ghost = layer(snapshot(dragged.image), dragged.box, t('draggingPanel', { agent }), `panel-drag-image ${source.agent}`);
      document.body.append(ghost);
    }
    ghost!.style.left = `${pointer.clientX - offset.x}px`; ghost!.style.top = `${pointer.clientY - offset.y}px`;
    show(target(pointer.clientX, pointer.clientY));
  };
  return {
    move,
    result(release: PointerEvent): DragResult | undefined {
      // Pointerup may be delivered without a final pointermove.
      move(release);
      return moving ? next : undefined;
    },
    dispose() {
      ghost?.remove(); preview?.remove(); canvas.classList.remove('dragging', 'placing');
      for (const element of [dragged.element, ...covering, ...images.map(image => image.element)]) element.classList.remove('panel-drag-hidden');
    },
  };
}
