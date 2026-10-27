import { message, detail } from '../shared/messages';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../shared/model';
import { defaultShortcuts, shortcutActions, shortcutConflicts, type ShortcutAction, type Shortcuts } from '../shared/shortcuts';

import { defaultSettings, settingsIssues, type SettingsIssue, type SettingsSaveResult } from '../shared/settings';
export { defaultSettings } from '../shared/settings';

function rejectIssues(issues: SettingsIssue[]): void {
  if (issues.length) throw new Error(message('validationFailed', { reasons: issues.map(issue => detail(issue.message)) }));
}

function validateSettings(value: Settings): void { rejectIssues(settingsIssues(value)); }

// Defaulted actions whose default binding matches a user-written action, when that is every conflict.
// Any conflict the user wrote, including one with a system shortcut, leaves nothing to tolerate.
function defaultShortcutConflicts(shortcuts: Settings['shortcuts'], defaulted: readonly ShortcutAction[]): ShortcutAction[] {
  const conflicts = shortcutConflicts(shortcuts);
  if (conflicts.some(group => group.system || group.actions.filter(action => !defaulted.includes(action)).length > 1)) return [];
  return conflicts.flatMap(group => group.actions).filter(action => defaulted.includes(action));
}

export class SettingsFile {
  private writes: Promise<void> = Promise.resolve();
  private readable = true;
  // Defaulted actions in a default shortcut conflict. They stay out of settings.json until the
  // shortcuts are saved, so the next startup reports the same conflict.
  private conflictingDefaults: ShortcutAction[] = [];
  constructor(private directory: string) {}
  get hasDefaultShortcutConflict() { return this.conflictingDefaults.length > 0; }
  async read(): Promise<Settings> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message('settingsCorrupt'));
      if (value.shortcuts !== undefined && (!value.shortcuts || typeof value.shortcuts !== 'object' || Array.isArray(value.shortcuts))) throw new Error(message('shortcutsInvalid'));
      const defaulted = shortcutActions.filter(action => value.shortcuts?.[action] === undefined);
      const settings: Settings = { ...defaultSettings(), ...value, shortcuts: { ...defaultShortcuts(), ...value.shortcuts } };
      const conflictingDefaults = defaultShortcutConflicts(settings.shortcuts, defaulted);
      rejectIssues(settingsIssues(settings).filter(issue => !conflictingDefaults.length || issue.code !== 'conflict'));
      this.conflictingDefaults = conflictingDefaults;
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      this.readable = false;
      throw new Error(message('settingsReadFailed', { reason: detail((error as Error).message) }), { cause: error });
    }
  }
  saveOnQuit(settings: Settings): Promise<void> {
    // The next startup asks again for a default shortcut conflict left unresolved.
    if (this.hasDefaultShortcutConflict) return Promise.resolve();
    validateSettings(settings);
    return this.write(settings);
  }
  async commit(current: Settings, patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const settings = { ...current, ...patch };
    // Saving shortcuts must resolve a default shortcut conflict; other categories save around it.
    const savingShortcuts = 'shortcuts' in patch;
    const issues = settingsIssues(settings).filter(issue => savingShortcuts || !this.hasDefaultShortcutConflict || issue.code !== 'conflict');
    if (issues.length) return { ok: false, kind: 'validation', issues };
    const shortcuts = Object.fromEntries(Object.entries(settings.shortcuts)
      .filter(([action]) => savingShortcuts || !this.conflictingDefaults.includes(action as ShortcutAction)));
    try {
      await this.write({ ...settings, shortcuts });
      if (savingShortcuts) this.conflictingDefaults = [];
      return { ok: true, settings };
    } catch (error) { return { ok: false, kind: 'storage', message: (error as Error).message }; }
  }
  private write(settings: Omit<Settings, 'shortcuts'> & { shortcuts: Partial<Shortcuts> }): Promise<void> {
    if (!this.readable) return Promise.reject(new Error(message('settingsUnreadable')));
    const contents = JSON.stringify(settings, null, 2) + '\n';
    const write = this.writes.then(async () => {
      const temporary = join(this.directory, 'settings.json.tmp');
      try {
        await mkdir(this.directory, { recursive: true });
        await writeFile(temporary, contents, { mode: 0o600, flush: true });
        await rename(temporary, join(this.directory, 'settings.json'));
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw new Error(message('settingsWriteFailed'), { cause: error });
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
