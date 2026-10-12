import { agentNames, type Panel, type Layout } from '../shared/model';

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

export function beginPanelDrag({ event, handle, canvas, source, panels, layout, commit, consumed }: {
  event: PointerEvent; handle: HTMLElement; canvas: HTMLElement; source: string; panels: Panel[]; layout: Layout;
  commit(layout: Layout): void; consumed(): void;
}): () => void {
  const original = structuredClone(layout);
  const images = panels.map(panel => {
    const element = canvas.querySelector<HTMLElement>(`[data-panel-id="${panel.id}"] .agent-panel`)!;
    return { panel, element, box: element.getBoundingClientRect(), image: snapshot(element) };
  });
  const dragged = images.find(image => image.panel.id === source)!;
  const offset = { x: event.clientX - dragged.box.x, y: event.clientY - dragged.box.y };
  let moving = false, finished = false, target: string | undefined;
  let ghost: HTMLDivElement | undefined, preview: HTMLDivElement | undefined;
  handle.setPointerCapture(event.pointerId);
  const layer = (image: HTMLElement, box: DOMRect, label: string, className: string) => {
    const wrapper = document.createElement('div');
    wrapper.className = className;
    wrapper.setAttribute('role', 'img'); wrapper.setAttribute('aria-label', label);
    Object.assign(wrapper.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    wrapper.append(image); return wrapper;
  };
  const showTarget = (id?: string) => {
    if (id === target) return;
    target = id; preview?.remove(); preview = undefined;
    if (!id) return;
    const other = images.find(image => image.panel.id === id)!;
    preview = document.createElement('div'); preview.className = 'panel-swap-preview';
    preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', `交换预览：${agentNames[dragged.panel.agent]} 与 ${agentNames[other.panel.agent]}`);
    preview.append(layer(snapshot(dragged.image), other.box, agentNames[dragged.panel.agent], `panel-preview-image ${dragged.panel.agent}`),
      layer(snapshot(other.image), dragged.box, agentNames[other.panel.agent], `panel-preview-image ${other.panel.agent}`));
    document.body.append(preview);
  };
  const move = (pointer: PointerEvent) => {
    if (pointer.pointerId !== event.pointerId) return;
    if (!moving && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 5) return;
    if (!moving) {
      moving = true; consumed(); canvas.classList.add('dragging');
      ghost = layer(snapshot(dragged.image), dragged.box, `拖动中的 ${agentNames[dragged.panel.agent]} 面板`, `panel-drag-image ${dragged.panel.agent}`);
      document.body.append(ghost);
    }
    ghost!.style.left = `${pointer.clientX - offset.x}px`; ghost!.style.top = `${pointer.clientY - offset.y}px`;
    // Hit testing always uses the original areas, never a displayed preview's identity.
    const under = images.find(({ box }) => pointer.clientX >= box.left && pointer.clientX < box.right && pointer.clientY >= box.top && pointer.clientY < box.bottom);
    showTarget(under?.panel.id === source ? undefined : under?.panel.id);
  };
  const finish = (save: boolean) => {
    if (finished) return;
    finished = true;
    handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel); handle.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('resize', cancel);
    window.removeEventListener('keydown', keydown, true);
    observer.disconnect();
    ghost?.remove(); preview?.remove(); canvas.classList.remove('dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    if (save && moving && target) {
      const swap = (node: Layout): Layout => 'panel' in node ? { panel: node.panel === source ? target! : node.panel === target ? source : node.panel }
        : { ...node, first: swap(node.first), second: swap(node.second) };
      commit(swap(original));
    }
  };
  const up = (pointer: PointerEvent) => { if (pointer.pointerId === event.pointerId) finish(true); };
  const cancel = () => finish(false);
  const keydown = (key: KeyboardEvent) => { if (key.key === 'Escape') { key.preventDefault(); key.stopImmediatePropagation(); cancel(); } };
  const bounds = canvas.getBoundingClientRect();
  const observer = new ResizeObserver(() => {
    const current = canvas.getBoundingClientRect();
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) cancel();
  });
  observer.observe(canvas);
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel); handle.addEventListener('lostpointercapture', cancel);
  window.addEventListener('resize', cancel);
  window.addEventListener('keydown', keydown, true);
  return cancel;
}
