import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { agentTypes, type Settings } from '../shared/model';

export const defaultSettings = (): Settings => ({ theme: 'system', agents: {
  codex: { command: 'codex', args: [] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
} });

export function validateSettings(value: Settings): void {
  if (!value || !['system', 'dark', 'light'].includes(value.theme) || agentTypes.some(type => {
    const command = value.agents?.[type];
    return !command || typeof command.command !== 'string' || !command.command.trim() || !Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string');
  })) throw new Error('配置文件损坏，请修正 settings.json 后重新启动');
}

export class SettingsFile {
  private writes: Promise<void> = Promise.resolve();
  private readable = true;
  constructor(private directory: string) {}
  async read(): Promise<Settings> {
    try {
      const settings: Settings = JSON.parse(await readFile(join(this.directory, 'settings.json'), 'utf8'));
      validateSettings(settings);
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
      this.readable = false;
      throw new Error('配置读取失败，请检查 settings.json', { cause: error });
    }
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
