import { message, detail } from './messages';
export const shortcutActions = ['previousProject', 'nextProject', 'previousPanel', 'nextPanel', 'maximizePanel', 'addPanel', 'closePanel', 'settings'] as const;
export type ShortcutAction = typeof shortcutActions[number];
export type Shortcuts = Record<ShortcutAction, string>;
export const shortcutNames: Record<ShortcutAction, string> = {
  previousProject: message('previousProject'), nextProject: message('nextProject'), previousPanel: message('previousPanel'), nextPanel: message('nextPanel'),
  maximizePanel: message('maximizePanel'), addPanel: message('addPanel'), closePanel: message('closePanel'), settings: message('openSettings'),
};
export const defaultShortcuts = (): Shortcuts => ({
  previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+]',
  maximizePanel: 'Command+Enter', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,',
});
const reserved: Record<string, string> = {
  'Command+C': message('copy'), 'Command+V': message('paste'), 'Command+X': message('cut'), 'Command+A': message('selectAll'), 'Command+Z': message('undo'), 'Command+Shift+Z': message('redo'),
  'Command+Q': message('quitWorkbench'), 'Command+W': message('closeWindow'), 'Command+H': message('hideWorkbench'), 'Command+Alt+H': message('hideOthers'),
  'Command+M': message('minimize'), 'Command+Tab': message('switchApplications'), 'Command+Shift+Tab': message('switchApplications'), 'Command+Space': message('systemSearch'),
};
const codeKeys: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'", Backquote: '`', Minus: '-', Equal: '=',
};
const validKey = (key: string) => /^[A-Z0-9]$/.test(key) || Object.values(codeKeys).includes(key)
  || ['Enter', 'Tab', 'Space', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)
  || /^F([1-9]|1[0-9]|2[0-4])$/.test(key);

// One canonical spelling is shared by hand-edited settings, the recorder and dispatch.
export function shortcutFormatError(binding: unknown): string | undefined {
  if (typeof binding !== 'string') return message('shortcutInvalid');
  const parts = binding.split('+'), key = parts.pop()!;
  const modifiers = ['Command', 'Control', 'Alt', 'Shift'].filter(modifier => parts.includes(modifier));
  if (!validKey(key) || !parts.some(modifier => ['Command', 'Control', 'Alt'].includes(modifier)) || [...modifiers, key].join('+') !== binding)
    return message('shortcutInvalid');
}

export function validateShortcutFormats(shortcuts: Shortcuts): void {
  for (const action of shortcutActions) {
    const error = shortcutFormatError(shortcuts?.[action]);
    if (error) throw new Error(message('shortcutField', { action: detail(shortcutNames[action]), reason: detail(error) }));
  }
}

export interface ShortcutConflict { binding: string; actions: ShortcutAction[]; system?: string }
export function shortcutConflictMessage(conflict: ShortcutConflict, excludedAction?: ShortcutAction): string {
  const actions = conflict.actions.filter(action => action !== excludedAction).map(action => detail(shortcutNames[action]));
  if (conflict.system) actions.push(detail(message('systemShortcut', { action: detail(conflict.system) })));
  return message('shortcutConflict', { actions });
}
export function shortcutConflicts(shortcuts: Shortcuts): ShortcutConflict[] {
  const groups = new Map<string, ShortcutAction[]>();
  for (const action of shortcutActions) {
    const binding = shortcuts?.[action];
    if (shortcutFormatError(binding)) continue;
    groups.set(binding, [...groups.get(binding) ?? [], action]);
  }
  return [...groups].filter(([binding, actions]) => actions.length > 1 || reserved[binding])
    .map(([binding, actions]) => ({ binding, actions, system: reserved[binding] }));
}

export function validateShortcuts(shortcuts: Shortcuts): void {
  validateShortcutFormats(shortcuts);
  const conflict = shortcutConflicts(shortcuts)[0];
  if (conflict) throw new Error(shortcutConflictMessage(conflict));
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
