export const shortcutActions = ['previousProject', 'nextProject', 'previousPanel', 'nextPanel', 'maximizePanel', 'addPanel', 'closePanel', 'settings'] as const;
export type ShortcutAction = typeof shortcutActions[number];
export type Shortcuts = Record<ShortcutAction, string>;
export const shortcutNames: Record<ShortcutAction, string> = {
  previousProject: '切换到上一个项目', nextProject: '切换到下一个项目', previousPanel: '切换到上一个面板', nextPanel: '切换到下一个面板',
  maximizePanel: '放大 / 还原面板', addPanel: '添加 Agent', closePanel: '关闭面板', settings: '打开全局设置',
};
export const defaultShortcuts = (): Shortcuts => ({
  previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+]',
  maximizePanel: 'Command+Enter', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,',
});
const reserved: Record<string, string> = {
  'Command+C': '复制', 'Command+V': '粘贴', 'Command+X': '剪切', 'Command+A': '全选', 'Command+Z': '撤销', 'Command+Shift+Z': '重做',
  'Command+Q': '退出工作台', 'Command+W': '关闭窗口', 'Command+H': '隐藏工作台', 'Command+Alt+H': '隐藏其他应用',
  'Command+M': '最小化窗口', 'Command+Tab': '系统应用切换', 'Command+Shift+Tab': '系统应用切换', 'Command+Space': '系统搜索',
};
const codeKeys: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=',
};
const validKey = (key: string) => /^[A-Z0-9]$/.test(key) || Object.values(codeKeys).includes(key)
  || ['Enter', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)
  || /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

// One canonical spelling is shared by hand-edited settings, the recorder and dispatch.
export function validateShortcutFormats(shortcuts: Shortcuts): void {
  for (const action of shortcutActions) {
    const binding = shortcuts?.[action];
    if (typeof binding !== 'string') throw new Error(`快捷键无效：${shortcutNames[action]}`);
    const parts = binding.split('+'), key = parts.pop()!;
    const modifiers = ['Command', 'Control', 'Alt', 'Shift'].filter(modifier => parts.includes(modifier));
    if (!validKey(key) || !parts.some(modifier => ['Command', 'Control', 'Alt'].includes(modifier)) || [...modifiers, key].join('+') !== binding)
      throw new Error(`快捷键无效：${shortcutNames[action]}，请使用 Command、Control 或 Alt 组合键`);
  }
}

export interface ShortcutConflict { binding: string; actions: ShortcutAction[]; system?: string }
export function shortcutConflicts(shortcuts: Shortcuts): ShortcutConflict[] {
  const groups = new Map<string, ShortcutAction[]>();
  for (const action of shortcutActions) {
    const binding = shortcuts[action];
    groups.set(binding, [...groups.get(binding) ?? [], action]);
  }
  return [...groups].filter(([binding, actions]) => actions.length > 1 || reserved[binding])
    .map(([binding, actions]) => ({ binding, actions, system: reserved[binding] }));
}

export function validateShortcuts(shortcuts: Shortcuts): void {
  validateShortcutFormats(shortcuts);
  const conflict = shortcutConflicts(shortcuts)[0];
  if (conflict) throw new Error(`快捷键冲突：${conflict.actions.map(action => `「${shortcutNames[action]}」`).concat(conflict.system ? [`系统「${conflict.system}」`] : []).join('与')}使用了相同组合键`);
}

export function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'isComposing'>): string | undefined {
  if (event.isComposing || !(event.metaKey || event.ctrlKey || event.altKey)) return;
  const key = codeKeys[event.code] ?? (/^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, '') : event.code);
  if (!validKey(key)) return;
  return [event.metaKey && 'Command', event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+');
}

export function displayShortcut(binding: string): string {
  return binding.replace('Command+', '⌘ ').replace('Control+', '⌃ ').replace('Alt+', '⌥ ').replace('Shift+', '⇧ ').replace('Enter', '↵');
}
