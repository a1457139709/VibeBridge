import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { agentNames, agentTypes, type Settings } from '../shared/model';
import { defaultShortcuts, shortcutActions, shortcutConflicts, validateShortcutFormats, validateShortcuts } from '../shared/shortcuts';

import { defaultSettings } from '../shared/settings';
export { defaultSettings } from '../shared/settings';

export class SettingsFieldError extends Error {
  constructor(public fields: Record<string, string>, message: string) { super(message); }
}

export function validateSettings(value: Settings, allowShortcutConflicts = false): void {
  if (!value || !['system', 'dark', 'light'].includes(value.theme) || !['auto', 'row', 'column'].includes(value.defaultLayout) || agentTypes.some(type => {
    const command = value.agents?.[type];
    return !command || typeof command.command !== 'string' || !Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string');
  })) throw new Error('配置文件损坏，请修正 settings.json 后重新启动');
  const empty = agentTypes.filter(type => !value.agents[type].command.trim());
  if (empty.length) throw new SettingsFieldError(Object.fromEntries(empty.map(type => [`agents.${type}.command`, '启动命令不能为空'])), `${agentNames[empty[0]]}：启动命令不能为空`);
  if (allowShortcutConflicts) validateShortcutFormats(value.shortcuts); else validateShortcuts(value.shortcuts);
}

export class SettingsFile {
  private writes: Promise<void> = Promise.resolve();
  private readable = true;
  private migratedConflict = false;
  constructor(private directory: string) {}
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
    // A compatible missing-action migration is an in-memory draft until the user resolves it.
    if (this.readable && this.migratedConflict && shortcutConflicts(settings.shortcuts).length) return Promise.resolve();
    return this.save(settings);
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
