import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../shared/model';
import { defaultShortcuts, shortcutActions, shortcutConflicts, validateShortcuts } from '../shared/shortcuts';

import { defaultSettings, settingsIssues, type SettingsSaveResult } from '../shared/settings';
export { defaultSettings } from '../shared/settings';

export function validateSettings(value: Settings, allowShortcutConflicts = false): void {
  const issues = settingsIssues(value).filter(issue => !allowShortcutConflicts || issue.code !== 'conflict');
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'));
}

export class SettingsFile {
  private writes: Promise<void> = Promise.resolve();
  private readable = true;
  private migratedConflict = false;
  constructor(private directory: string) {}
  get hasMigrationConflict() { return this.migratedConflict; }
  async read(): Promise<Settings> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置文件损坏');
      if (value.shortcuts !== undefined && (!value.shortcuts || typeof value.shortcuts !== 'object' || Array.isArray(value.shortcuts))) throw new Error('快捷键配置无效');
      const missing = shortcutActions.filter(action => value.shortcuts?.[action] === undefined);
      const settings: Settings = { ...defaultSettings(), ...value, shortcuts: { ...defaultShortcuts(), ...value.shortcuts } };
      validateSettings(settings, true);
      const conflicts = shortcutConflicts(settings.shortcuts);
      if (conflicts.some(group => group.system || group.actions.filter(action => !missing.includes(action)).length > 1)) validateShortcuts(settings.shortcuts);
      this.migratedConflict = conflicts.length > 0;
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      this.readable = false;
      throw new Error(`配置读取失败，请检查 settings.json：${(error as Error).message}`, { cause: error });
    }
  }
  saveOnQuit(settings: Settings): Promise<void> {
    // Preserve the original file until the user repairs a missing-action migration conflict.
    if (this.readable && this.migratedConflict && shortcutConflicts(settings.shortcuts).length) return Promise.resolve();
    return this.save(settings);
  }
  async commit(current: Settings, patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const settings = { ...current, ...patch };
    const issues = settingsIssues(settings);
    if (issues.length) return { ok: false, kind: 'validation', issues };
    try {
      await this.save(settings);
      this.migratedConflict = false;
      return { ok: true, settings };
    } catch (error) { return { ok: false, kind: 'storage', message: (error as Error).message }; }
  }
  save(settings: Settings): Promise<void> {
    validateSettings(settings);
    if (!this.readable) return Promise.reject(new Error('配置读取失败，未覆盖原配置；请修正后重新启动'));
    const contents = JSON.stringify(settings, null, 2) + '\n';
    const write = this.writes.then(async () => {
      const temporary = join(this.directory, 'settings.json.tmp');
      try {
        await mkdir(this.directory, { recursive: true });
        await writeFile(temporary, contents, { mode: 0o600, flush: true });
        await rename(temporary, join(this.directory, 'settings.json'));
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw new Error('配置保存失败', { cause: error });
      }
    });
    this.writes = write.catch(() => {});
    return write;
  }
}
