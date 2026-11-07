import { removeFromLayout, type Layout } from './model';
export interface Box { x: number; y: number; width: number; height: number }
export interface Divider { path: ('first' | 'second')[]; axis: 'row' | 'column'; ratio: number; box: Box }
export function layoutBoxes(layout: Layout | null) {
  const panels = new Map<string, Box>(), dividers: Divider[] = [];
  const visit = (node: Layout, box: Box, path: Divider['path']) => {
    if ('panel' in node) { panels.set(node.panel, box); return; }
    dividers.push({ path, axis: node.axis, ratio: node.ratio, box });
    const { x, y, width, height } = box;
    const row = node.axis === 'row';
    visit(node.first, { x, y, width: row ? width * node.ratio : width, height: row ? height : height * node.ratio }, [...path, 'first']);
    visit(node.second, { x: row ? x + width * node.ratio : x, y: row ? y : y + height * node.ratio, width: row ? width * (1 - node.ratio) : width, height: row ? height : height * (1 - node.ratio) }, [...path, 'second']);
  };
  if (layout) visit(layout, { x: 0, y: 0, width: 1, height: 1 }, []);
  return { panels, dividers };
}

export type Side = 'top' | 'bottom' | 'left' | 'right';
/** Where a dragged panel lands: beside or in place of a resident panel, or along a whole side of the layout area. */
export type Drop = { kind: 'split'; panel: string; side: Side } | { kind: 'swap'; panel: string } | { kind: 'fill'; side: Side };

// The share of the layout area a panel takes when it fills a whole side: a fixed value, not a setting.
const fillRatio = .5;
// The share of a resident panel a dropped panel takes when it splits that panel.
const splitRatio = .5;
const along = (side: Side, dropped: Layout, other: Layout, ratio: number): Layout => {
  const axis = side === 'left' || side === 'right' ? 'row' : 'column';
  return side === 'left' || side === 'top' ? { axis, ratio, first: dropped, second: other } : { axis, ratio: 1 - ratio, first: other, second: dropped };
};

/** The layout after dropping a panel. A panel already in the layout leaves its place before it is placed again. */
export function dropIntoLayout(layout: Layout | null, panel: string, drop: Drop): Layout {
  // Swapping exchanges places; a panel from outside the layout takes the target's place.
  if (drop.kind === 'swap' && layout) {
    const swap = (node: Layout): Layout => 'panel' in node
      ? { panel: node.panel === panel ? drop.panel : node.panel === drop.panel ? panel : node.panel }
      : { ...node, first: swap(node.first), second: swap(node.second) };
    return swap(layout);
  }
  const rest = removeFromLayout(layout, panel);
  if (!rest) return { panel };
  if (drop.kind === 'fill') return along(drop.side, { panel }, rest, fillRatio);
  const split = (node: Layout): Layout => 'panel' in node
    ? drop.kind === 'split' && node.panel === drop.panel ? along(drop.side, { panel }, node, splitRatio) : node
    : { ...node, first: split(node.first), second: split(node.second) };
  return split(rest);
}
