// PROTOTYPE — throwaway, part of prototype-ephemeral-panels.tsx. Never import or adapt into production (AGENTS.md「Prototype scope」).

export const docks = [
  { key: 'tray', name: '底部托盘' },
  { key: 'rail', name: '右侧竖条' },
  { key: 'nav', name: '导航子项' },
  { key: 'toolbar', name: '工具栏胶囊' },
] as const;
export const views = [
  { key: 'maximize', name: '临时放大' },
  { key: 'slot', name: '临时占位' },
  { key: 'column', name: '右侧分栏' },
] as const;
export const columnModes = [
  { key: 'push', name: '挤压' },
  { key: 'overlay', name: '覆盖' },
] as const;
export const chromes = [
  { key: 'top', name: '工具栏：项目名 · 汇总居中 · ＋' },
  { key: 'old', name: '旧版：底栏汇总' },
] as const;
export type Chrome = typeof chromes[number]['key'];
export type ColumnMode = typeof columnModes[number]['key'];
export type Dock = typeof docks[number]['key'];
export type View = typeof views[number]['key'];

export const param = <T extends string>(name: string, keys: readonly T[], fallback: T): T => {
  const value = new URLSearchParams(location.search).get(name);
  return keys.includes(value as T) ? value as T : fallback;
};
export const typing = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input, textarea, [contenteditable]');
