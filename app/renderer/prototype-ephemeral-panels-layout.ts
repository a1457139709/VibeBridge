// PROTOTYPE — throwaway, part of prototype-ephemeral-panels.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).
import type React from 'react';

export type Tree = { panel: string } | { axis: 'row' | 'column'; ratio: number; first: Tree; second: Tree };
export interface Box { x: number; y: number; w: number; h: number }

export function boxes(node: Tree, box: Box = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<string, Box>()) {
  if ('panel' in node) { out.set(node.panel, box); return out; }
  const r = node.ratio;
  if (node.axis === 'row') { boxes(node.first, { ...box, w: box.w * r }, out); boxes(node.second, { ...box, x: box.x + box.w * r, w: box.w * (1 - r) }, out); }
  else { boxes(node.first, { ...box, h: box.h * r }, out); boxes(node.second, { ...box, y: box.y + box.h * r, h: box.h * (1 - r) }, out); }
  return out;
}
// Mirrors today's "split the largest region" rule only so pinning shows the pain point it would inherit.
export function splitLargest(tree: Tree, id: string): Tree {
  let target = '', area = 0, axis: 'row' | 'column' = 'row';
  for (const [panel, b] of boxes(tree)) if (b.w * b.h > area) { target = panel; area = b.w * b.h; axis = b.w >= b.h ? 'row' : 'column'; }
  const walk = (n: Tree): Tree => 'panel' in n ? n.panel === target ? { axis, ratio: 0.5, first: n, second: { panel: id } } : n : { ...n, first: walk(n.first), second: walk(n.second) };
  return walk(tree);
}

export type Side = 'left' | 'right' | 'top' | 'bottom';
export const ROOT = '@layout'; // drop target meaning "the whole layout area's edge"
export type Path = ('first' | 'second')[];
export function splitList(node: Tree, box: Box = { x: 0, y: 0, w: 1, h: 1 }, path: Path = [], out: { path: Path; axis: 'row' | 'column'; box: Box; ratio: number }[] = []) {
  if ('panel' in node) return out;
  out.push({ path, axis: node.axis, box, ratio: node.ratio });
  const r = node.ratio;
  const [a, b] = node.axis === 'row'
    ? [{ ...box, w: box.w * r }, { ...box, x: box.x + box.w * r, w: box.w * (1 - r) }]
    : [{ ...box, h: box.h * r }, { ...box, y: box.y + box.h * r, h: box.h * (1 - r) }];
  splitList(node.first, a, [...path, 'first'], out); splitList(node.second, b, [...path, 'second'], out);
  return out;
}
export function setRatio(node: Tree, path: Path, ratio: number): Tree {
  if ('panel' in node) return node;
  if (!path.length) return { ...node, ratio };
  const [head, ...rest] = path;
  return { ...node, [head]: setRatio(node[head], rest, ratio) };
}
// Drop onto a panel: split that panel on the side the pointer is nearest to.
export function splitAt(tree: Tree | null, target: string, id: string, side: Side): Tree {
  if (!tree) return { panel: id };
  const before = side === 'left' || side === 'top', axis = side === 'left' || side === 'right' ? 'row' : 'column';
  if (target === ROOT) return { axis, ratio: 0.5, first: before ? { panel: id } : tree, second: before ? tree : { panel: id } };
  const walk = (n: Tree): Tree => 'panel' in n
    ? n.panel === target ? { axis, ratio: 0.5, first: before ? { panel: id } : n, second: before ? n : { panel: id } } : n
    : { ...n, first: walk(n.first), second: walk(n.second) };
  return walk(tree);
}
export function removeFrom(tree: Tree | null, id: string): Tree | null {
  if (!tree) return null;
  if ('panel' in tree) return tree.panel === id ? null : tree;
  const first = removeFrom(tree.first, id), second = removeFrom(tree.second, id);
  return first && second ? { ...tree, first, second } : first ?? second;
}
export const sideOf = (event: React.DragEvent<HTMLElement>): Side => {
  const r = event.currentTarget.getBoundingClientRect();
  const dx = (event.clientX - r.left) / r.width - 0.5, dy = (event.clientY - r.top) / r.height - 0.5;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
};
