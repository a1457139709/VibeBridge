import type { Layout } from '../shared/model';
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
