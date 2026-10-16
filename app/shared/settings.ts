import { agentNames, agentTypes, type Settings } from './model';
import { defaultShortcuts, shortcutActions, shortcutConflicts, shortcutFormatError, shortcutNames } from './shortcuts';

export const defaultSettings = (): Settings => ({ theme: 'system', defaultLayout: 'auto', shortcuts: defaultShortcuts(), agents: {
  codex: { command: 'codex', args: [] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
} });

interface FieldIssue { field: string; code: 'required' | 'invalid' | 'conflict'; message: string }

// Navigation, draft selection and validation all follow this definition's order.
export const settingsCategories = [
  { id: 'agents', name: 'Agent', keys: ['agents'], validate(settings: Settings): FieldIssue[] {
    return agentTypes.flatMap(type => {
      const value = settings.agents?.[type];
      const issues: FieldIssue[] = [];
      if (typeof value?.command !== 'string') issues.push({ field: `agents.${type}.command`, code: 'invalid', message: `${agentNames[type]}：启动命令无效` });
      else if (!value.command.trim()) issues.push({ field: `agents.${type}.command`, code: 'required', message: '启动命令不能为空' });
      if (!Array.isArray(value?.args) || value.args.some(arg => typeof arg !== 'string')) issues.push({ field: `agents.${type}.args`, code: 'invalid', message: '启动参数须为字符串列表' });
      return issues;
    });
  } },
  { id: 'appearance', name: '外观', keys: ['theme', 'defaultLayout'], validate(settings: Settings): FieldIssue[] {
    const issues: FieldIssue[] = [];
    if (!['system', 'dark', 'light'].includes(settings.theme)) issues.push({ field: 'theme', code: 'invalid', message: '主题无效' });
    if (!['auto', 'row', 'column'].includes(settings.defaultLayout)) issues.push({ field: 'defaultLayout', code: 'invalid', message: '默认布局无效' });
    return issues;
  } },
  { id: 'shortcuts', name: '快捷键', keys: ['shortcuts'], validate(settings: Settings): FieldIssue[] {
    const issues: FieldIssue[] = shortcutActions.flatMap(action => {
      const message = shortcutFormatError(settings.shortcuts?.[action]);
      return message ? [{ field: `shortcuts.${action}`, code: 'invalid' as const, message }] : [];
    });
    for (const conflict of shortcutConflicts(settings.shortcuts)) {
      for (const action of conflict.actions) issues.push({ field: `shortcuts.${action}`, code: 'conflict',
        message: `快捷键冲突：${conflict.actions.filter(other => other !== action).map(other => shortcutNames[other]).concat(conflict.system ? [`系统「${conflict.system}」`] : []).join('、')}` });
    }
    return issues;
  } },
] as const satisfies readonly { id: string; name: string; keys: readonly (keyof Settings)[]; validate(settings: Settings): FieldIssue[] }[];

export type SettingsCategory = typeof settingsCategories[number]['id'];
export interface SettingsIssue extends FieldIssue { category: SettingsCategory }
export type SettingsSaveResult = { ok: true; settings: Settings }
  | { ok: false; kind: 'validation'; issues: SettingsIssue[] }
  | { ok: false; kind: 'storage' | 'unavailable'; message: string };

export function settingsIssues(settings: Settings): SettingsIssue[] {
  return settingsCategories.flatMap(category => category.validate(settings).map(issue => ({ ...issue, category: category.id })));
}

export function settingsPatch(draft: Settings, categories: readonly SettingsCategory[]): Partial<Settings> {
  return Object.fromEntries(settingsCategories.filter(category => categories.includes(category.id))
    .flatMap(category => category.keys.map(key => [key, draft[key]])));
}

export function dirtySettingsCategories(draft: Settings, saved: Settings): SettingsCategory[] {
  return settingsCategories.filter(category => category.keys.some(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))).map(category => category.id);
}
