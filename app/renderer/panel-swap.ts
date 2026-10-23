import { agentNames, type Panel, type Layout, type Language } from '../shared/model';
import { localize } from '../shared/localization';

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

export function createSwapPreview({ event, canvas, source, panels, layout, consumed, language = 'en' }: {
  event: PointerEvent; canvas: HTMLElement; source: string; panels: Panel[]; layout: Layout;
  language?: Language;
  consumed(): void;
}) {
  const { t } = localize(language);
  const original = structuredClone(layout);
  const images = panels.map(panel => {
    const element = canvas.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"] .agent-panel`)!;
    return { panel, element, box: element.getBoundingClientRect(), image: snapshot(element) };
  });
  const dragged = images.find(image => image.panel.id === source)!;
  const offset = { x: event.clientX - dragged.box.x, y: event.clientY - dragged.box.y };
  let moving = false, target: string | undefined;
  let ghost: HTMLDivElement | undefined, preview: HTMLDivElement | undefined;
  const layer = (image: HTMLElement, box: DOMRect, label: string, className: string) => {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    wrapper.setAttribute('role', 'img'); wrapper.setAttribute('aria-label', label);
    Object.assign(wrapper.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    wrapper.append(image); return wrapper;
  };
  const showTarget = (id?: string) => {
    if (id === target) return;
    images.find(image => image.panel.id === target)?.element.classList.remove('panel-drag-hidden');
    target = id; preview?.remove(); preview = undefined;
    if (!id) return;
    const other = images.find(image => image.panel.id === id)!;
    preview = document.createElement('div'); preview.className = 'panel-swap-preview';
    preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', t('swapPreview', { first: agentNames[dragged.panel.agent], second: agentNames[other.panel.agent] }));
    other.element.classList.add('panel-drag-hidden');
    preview.append(layer(snapshot(other.image), dragged.box, agentNames[other.panel.agent], `panel-preview-image ${other.panel.agent}`));
    document.body.append(preview);
  };
  const move = (pointer: PointerEvent) => {
    if (!moving && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 5) return;
    if (!moving) {
      moving = true; consumed(); canvas.classList.add('dragging');
      dragged.element.classList.add('panel-drag-hidden');
      ghost = layer(snapshot(dragged.image), dragged.box, t('draggingPanel', { agent: agentNames[dragged.panel.agent] }), `panel-drag-image ${dragged.panel.agent}`);
      document.body.append(ghost);
    }
    ghost!.style.left = `${pointer.clientX - offset.x}px`; ghost!.style.top = `${pointer.clientY - offset.y}px`;
    // Hit testing always uses the original areas, never a displayed preview's identity.
    const under = images.find(({ box }) => pointer.clientX >= box.left && pointer.clientX < box.right && pointer.clientY >= box.top && pointer.clientY < box.bottom);
    showTarget(under?.panel.id === source ? undefined : under?.panel.id);
  };
  return {
    move,
    result(release: PointerEvent): Layout | undefined {
      // Pointerup may be delivered without a final pointermove.
      move(release);
      if (!moving || !target) return;
      const swap = (node: Layout): Layout => 'panel' in node ? { panel: node.panel === source ? target! : node.panel === target ? source : node.panel }
        : { ...node, first: swap(node.first), second: swap(node.second) };
      return swap(original);
    },
    dispose() {
      ghost?.remove(); preview?.remove(); canvas.classList.remove('dragging');
      for (const image of images) image.element.classList.remove('panel-drag-hidden');
    },
  };
}
