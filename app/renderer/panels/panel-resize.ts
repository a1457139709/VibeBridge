import type { Layout } from '../../shared/model';
import { layoutBoxes, type Divider } from '../../shared/layout';
import { panelMinimumSize } from './panel-measurement';
import { requireElement, requireValue } from '../common/required';

export function createResizePreview(
  canvas: HTMLElement,
  layout: Layout,
  divider: Divider,
  event: PointerEvent,
  present: (layout: Layout) => void,
) {
  const positions = layoutBoxes(layout);
  const bounds = canvas.getBoundingClientRect();
  const original = structuredClone(layout);
  let next = original;
  let node = original;
  for (const part of divider.path) {
    if ('panel' in node) return;
    node = node[part];
  }
  if ('panel' in node) return;
  const originalRatio = node.ratio;
  const dimension = divider.axis === 'row' ? bounds.width : bounds.height;
  const start = divider.axis === 'row' ? event.clientX : event.clientY;
  const leaves = (branch: Layout): string[] =>
    'panel' in branch ? [branch.panel] : [...leaves(branch.first), ...leaves(branch.second)];
  const required = (id: string, share: number) => {
    const box = requireValue(positions.panels.get(id), `panel ${id} in the layout`);
    const slot = requireElement(canvas, `[data-panel-id="${id}"]`);
    const panel = requireElement(slot, '.agent-panel');
    const slotStyle = getComputedStyle(slot);
    const minimum = panelMinimumSize(panel);
    const row = divider.axis === 'row';
    const chrome = row
      ? parseFloat(slotStyle.paddingLeft) + parseFloat(slotStyle.paddingRight)
      : parseFloat(slotStyle.paddingTop) + parseFloat(slotStyle.paddingBottom);
    const current = (row ? box.width : box.height) * dimension;
    return ((row ? minimum.width : minimum.height) + chrome) / (current / share);
  };
  const firstMinimum = Math.max(...leaves(node.first).map(id => required(id, originalRatio)));
  const secondMaximum = 1 - Math.max(...leaves(node.second).map(id => required(id, 1 - originalRatio)));
  let lower = Math.min(originalRatio, firstMinimum),
    upper = Math.max(originalRatio, secondMaximum);

  const move = (pointer: globalThis.PointerEvent) => {
    const candidate = structuredClone(original);
    let node = candidate;
    for (const part of divider.path) {
      if ('panel' in node) return;
      node = node[part];
    }
    if ('panel' in node) return;
    const box = divider.box;
    const delta = (divider.axis === 'row' ? pointer.clientX : pointer.clientY) - start;
    const ratio = originalRatio + delta / (dimension * (divider.axis === 'row' ? box.width : box.height));
    node.ratio = lower <= upper ? Math.max(lower, Math.min(upper, ratio)) : originalRatio;
    lower = Math.max(lower, Math.min(node.ratio, firstMinimum));
    upper = Math.min(upper, Math.max(node.ratio, secondMaximum));
    next = candidate;
    present(next);
  };
  return {
    move,
    result(release: PointerEvent) {
      move(release);
      return next;
    },
    dispose() {},
  };
}
