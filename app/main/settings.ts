import { message, detail } from '../shared/messages';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settings } from '../shared/model';

import { defaultSettings, readSettings, settingsCategories, settingsIssues, type SettingsSaveResult } from '../shared/settings';
export { defaultSettings } from '../shared/settings';

export class SettingsFile {
  private writes: Promise<void> = Promise.resolve();
  private readable = true;
  constructor(private directory: string) {}
  async read(): Promise<Settings> {
    try {
      return readSettings(JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      this.readable = false;
      throw new Error(message('settingsReadFailed', { reason: detail((error as Error).message) }), { cause: error });
    }
  }
  saveOnQuit(settings: Settings): Promise<void> { return this.write(settings); }
  async commit(current: Settings, patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const settings = { ...current, ...patch };
    // A settings conflict blocks only the categories being saved.
    const saving = settingsCategories.filter(category => category.keys.some(key => key in patch)).map(category => category.id);
    const issues = settingsIssues(settings).filter(issue => saving.includes(issue.category));
    if (issues.length) return { ok: false, kind: 'validation', issues };
    try {
      await this.write(settings);
      return { ok: true, settings };
    } catch (error) { return { ok: false, kind: 'storage', message: (error as Error).message }; }
  }
  private write(settings: Settings): Promise<void> {
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
