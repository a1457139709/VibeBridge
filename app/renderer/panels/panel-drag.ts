import { agentNames, type Panel, type Layout, type Language } from '../../shared/model';
import { dropIntoLayout, layoutBoxes, type Drop, type Side } from '../../shared/layout';
import { localize } from '../../shared/localization/localization';
import { requireElement, requireValue } from '../common/required';

const edgeBand = 24;
const sideNames = { top: 'sideTop', bottom: 'sideBottom', left: 'sideLeft', right: 'sideRight' } as const;

function frozenCopy(element: HTMLElement) {
  const copy = element.cloneNode(true);
  if (!(copy instanceof HTMLElement)) throw new Error('A panel copy is not an element');
  copy.inert = true;
  copy.removeAttribute('id');
  copy.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  copy.querySelectorAll('textarea, input').forEach(node => node.remove());
  const originals = element.querySelectorAll('canvas');
  copy
    .querySelectorAll('canvas')
    .forEach((canvas, index) => canvas.getContext('2d')?.drawImage(originals[index], 0, 0));
  const viewports = element.querySelectorAll<HTMLElement>('.xterm-viewport');
  copy.querySelectorAll<HTMLElement>('.xterm-viewport').forEach((viewport, index) => {
    viewport.scrollTop = viewports[index].scrollTop;
  });
  copy.style.height = '100%';
  copy.style.width = '100%';
  return copy;
}

const inside = (box: DOMRect, x: number, y: number) => x >= box.left && x < box.right && y >= box.top && y < box.bottom;
const nearest = (box: DOMRect, x: number, y: number): Side =>
  (
    [
      ['left', x - box.left],
      ['right', box.right - x],
      ['top', y - box.top],
      ['bottom', box.bottom - y],
    ] as const
  ).reduce((best, edge) => (edge[1] < best[1] ? edge : best))[0];

export function dropAt(
  canvas: DOMRect,
  panels: { id: string; box: DOMRect }[],
  source: string,
  x: number,
  y: number,
): Drop | undefined {
  if (!inside(canvas, x, y)) return;
  const side = nearest(canvas, x, y);
  if (
    (side === 'left'
      ? x - canvas.left
      : side === 'right'
        ? canvas.right - x
        : side === 'top'
          ? y - canvas.top
          : canvas.bottom - y) < edgeBand
  )
    return { kind: 'fill', side };
  const target = panels.find(({ box }) => inside(box, x, y));
  if (!target || target.id === source) return;
  const { box } = target;
  const middle = (offset: number, size: number) => offset >= size / 3 && offset <= (size * 2) / 3;
  return middle(x - box.left, box.width) && middle(y - box.top, box.height)
    ? { kind: 'swap', panel: target.id }
    : { kind: 'split', panel: target.id, side: nearest(box, x, y) };
}

export type DragResult = { kind: 'layout'; layout: Layout } | { kind: 'tray' };
type Target = Drop | { kind: 'tray' };

export function createDragPreview({
  event,
  canvas,
  source,
  element,
  panels,
  layout,
  tray,
  onDragStart,
  language = 'en',
}: {
  event: PointerEvent;
  canvas: HTMLElement;
  source: Panel;
  panels: Panel[];
  layout: Layout | null;
  element?: HTMLElement;
  tray?: HTMLElement | null;
  language?: Language;
  onDragStart(): void;
}) {
  const { t } = localize(language);
  const original = structuredClone(layout);
  const area = canvas.getBoundingClientRect();
  const images = panels.map(panel => {
    const slot = requireElement(canvas, `[data-panel-id="${panel.id}"]`);
    const element = requireElement(slot, '.agent-panel');
    return {
      panel,
      element,
      slot: slot.getBoundingClientRect(),
      box: element.getBoundingClientRect(),
      image: frozenCopy(element),
    };
  });
  const resident = images.find(image => image.panel.id === source.id);
  const trayImage = (element: HTMLElement) => ({
    panel: source,
    element,
    box: element.getBoundingClientRect(),
    image: frozenCopy(element),
  });
  const dragged = resident ?? trayImage(requireValue(element, 'the dragged tray panel element'));
  const agent = agentNames[source.agent];
  const trayArea = resident && tray ? tray.getBoundingClientRect() : undefined;
  const dropArea =
    trayArea?.height && trayArea.top > area.top && trayArea.top < area.bottom
      ? new DOMRect(area.x, area.y, area.width, trayArea.top - area.y)
      : area;
  const covering = resident
    ? []
    : [...canvas.querySelectorAll<HTMLElement>('.panel-slot')].filter(
        slot => !panels.some(panel => panel.id === slot.dataset.panelId),
      );
  const offset = { x: event.clientX - dragged.box.x, y: event.clientY - dragged.box.y };
  let moving = false,
    drop: Target | undefined,
    next: DragResult | undefined;
  let ghost: HTMLDivElement | undefined, preview: HTMLDivElement | undefined, hidden: HTMLElement | undefined;
  const figure = (className: string, label: string, box: { x: number; y: number; width: number; height: number }) => {
    const element = document.createElement('div');
    element.className = className;
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label);
    Object.assign(element.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    return element;
  };
  const layer = (image: HTMLElement, box: DOMRect, label: string, className: string) => {
    const wrapper = figure(className, label, box);
    wrapper.append(image);
    return wrapper;
  };
  const outline = (label: string, box: { x: number; y: number; width: number; height: number }) =>
    figure(`panel-drop-preview ${source.agent}`, label, box);
  const placed = (result: Layout) => {
    const box = requireValue(layoutBoxes(result).panels.get(source.id), 'the dragged panel in the layout');
    return {
      x: area.x + box.x * area.width,
      y: area.y + box.y * area.height,
      width: box.width * area.width,
      height: box.height * area.height,
    };
  };
  const swapPreview = (target: string, result: Layout) => {
    const other = requireValue(
      images.find(image => image.panel.id === target),
      'the swap target panel',
    );
    const element = document.createElement('div');
    element.className = 'panel-swap-preview';
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', t('swapPreview', { first: agent, second: agentNames[other.panel.agent] }));
    hidden = other.element;
    hidden.classList.add('panel-drag-hidden');
    element.append(
      resident
        ? layer(
            frozenCopy(other.image),
            dragged.box,
            agentNames[other.panel.agent],
            `panel-preview-image ${other.panel.agent}`,
          )
        : outline(agent, placed(result)),
    );
    return element;
  };
  const dropPreview = (drop: Exclude<Drop, { kind: 'swap' }>, result: Layout) =>
    outline(
      !original
        ? t('wholePreview', { agent })
        : drop.kind === 'fill'
          ? t('fillPreview', { agent, side: t(sideNames[drop.side]) })
          : t('splitPreview', {
              agent,
              side: t(sideNames[drop.side]),
              target:
                agentNames[
                  requireValue(
                    images.find(image => image.panel.id === drop.panel),
                    'the split target panel',
                  ).panel.agent
                ],
            }),
      placed(result),
    );
  const show = (candidate?: Target) => {
    if (JSON.stringify(candidate) === JSON.stringify(drop)) return;
    hidden?.classList.remove('panel-drag-hidden');
    hidden = undefined;
    preview?.remove();
    preview = undefined;
    drop = candidate;
    next = undefined;
    if (!drop) return;
    if (drop.kind === 'tray') {
      next = { kind: 'tray' };
      preview = outline(t('trayPreview', { agent }), requireValue(trayArea, 'the tray area'));
    } else {
      const result = dropIntoLayout(original, source.id, drop);
      if (JSON.stringify(result) === JSON.stringify(original)) return;
      next = { kind: 'layout', layout: result };
      preview = drop.kind === 'swap' ? swapPreview(drop.panel, result) : dropPreview(drop, result);
    }
    document.body.append(preview);
  };
  const target = (x: number, y: number): Target | undefined => {
    if (trayArea && inside(trayArea, x, y)) return { kind: 'tray' };
    if (!original) return inside(area, x, y) ? { kind: 'fill', side: nearest(area, x, y) } : undefined;
    return dropAt(
      dropArea,
      images.map(image => ({ id: image.panel.id, box: image.slot })),
      source.id,
      x,
      y,
    );
  };
  const move = (pointer: PointerEvent) => {
    if (!moving && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 5) return;
    if (!moving) {
      moving = true;
      onDragStart();
      canvas.classList.add('dragging');
      if (!resident) canvas.classList.add('placing');
      for (const slot of covering) slot.classList.add('panel-drag-hidden');
      dragged.element.classList.add('panel-drag-hidden');
      ghost = layer(
        frozenCopy(dragged.image),
        dragged.box,
        t('draggingPanel', { agent }),
        `panel-drag-image ${source.agent}`,
      );
      document.body.append(ghost);
    }
    const image = requireValue(ghost, 'the drag image');
    image.style.left = `${pointer.clientX - offset.x}px`;
    image.style.top = `${pointer.clientY - offset.y}px`;
    show(target(pointer.clientX, pointer.clientY));
  };
  return {
    move,
    result(release: PointerEvent): DragResult | undefined {
      move(release);
      return moving ? next : undefined;
    },
    dispose() {
      ghost?.remove();
      preview?.remove();
      canvas.classList.remove('dragging', 'placing');
      for (const element of [dragged.element, ...covering, ...images.map(image => image.element)])
        element.classList.remove('panel-drag-hidden');
    },
  };
}
