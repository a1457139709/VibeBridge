import { z } from 'zod';
import { message } from './messages';
import { agentNames, agentTypes, type AgentType, type Settings } from './model';
import { defaultShortcuts, shortcutActions, shortcutConflicts, shortcutConflictMessage, shortcutFormatError } from './shortcuts';

export const defaultSettings = (): Settings => ({ language: 'en', theme: 'system', defaultLayout: 'auto', shortcuts: defaultShortcuts(), agents: {
  codex: { command: 'codex', args: [] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
} });

interface FieldIssue { field: string; code: 'required' | 'invalid' | 'conflict'; message: string }

const command = (type: AgentType) => z.string({ error: message('commandInvalid', { agent: agentNames[type] }) })
  .refine(command => command.trim(), { error: message('commandRequired'), params: { code: 'required' } });
const args = z.array(z.string({ error: message('argumentsInvalid') }), { error: message('argumentsInvalid') });
const shortcut = z.string({ error: message('shortcutInvalid') }).refine(binding => !shortcutFormatError(binding), { error: message('shortcutInvalid') });

// The single definition of valid settings. Reading falls back to each field's default, so its
// result is always valid; saving reports each invalid field. Unknown keys pass through both.
function settingsSchema(reading: boolean) {
  const defaults = defaultSettings();
  const field = <T extends z.ZodType>(schema: T, fallback: unknown) => reading ? schema.catch(fallback as z.output<T>) : schema;
  const object = <T extends z.ZodRawShape>(shape: T, error: string) => z.looseObject(shape, { error });
  return z.looseObject({
    language: field(z.enum(['en', 'zh-CN'], { error: message('languageInvalid') }), defaults.language),
    theme: field(z.enum(['system', 'dark', 'light'], { error: message('themeInvalid') }), defaults.theme),
    defaultLayout: field(z.enum(['auto', 'row', 'column'], { error: message('layoutPreferenceInvalid') }), defaults.defaultLayout),
    agents: field(object(Object.fromEntries(agentTypes.map(type => [type, field(object({
      command: field(command(type), defaults.agents[type].command), args: field(args, []),
    }, message('commandInvalid', { agent: agentNames[type] })), defaults.agents[type])])), message('settingsInvalid')), defaults.agents),
    shortcuts: field(object(Object.fromEntries(shortcutActions.map(action => [action, field(shortcut, defaults.shortcuts[action])])),
      message('shortcutInvalid')), defaults.shortcuts),
  }, { error: message('settingsCorrupt') });
}
const readSchema = settingsSchema(true);
const saveSchema = settingsSchema(false);

/** Settings in the valid domain read from any JSON value; only a value that is not an object is rejected. */
export function readSettings(value: unknown): Settings {
  const result = readSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0].message);
  // Object.fromEntries erases the Agent type and action keys the schema guarantees.
  return result.data as unknown as Settings;
}

// Navigation, draft selection and validation all follow this definition's order. A category's
// conflicts are relations between fields that are each valid.
export const settingsCategories = [
  { id: 'general', keys: ['language'] },
  { id: 'agents', keys: ['agents'] },
  { id: 'appearance', keys: ['theme', 'defaultLayout'] },
  { id: 'shortcuts', keys: ['shortcuts'], conflicts(settings: Settings): FieldIssue[] {
    return shortcutConflicts(settings.shortcuts).flatMap(conflict => conflict.actions.map(action => ({
      field: `shortcuts.${action}`, code: 'conflict' as const, message: shortcutConflictMessage(conflict, action) })));
  } },
] as const satisfies readonly { id: string; keys: readonly (keyof Settings)[]; conflicts?(settings: Settings): FieldIssue[] }[];

export type SettingsCategory = typeof settingsCategories[number]['id'];
export interface SettingsIssue extends FieldIssue { category: SettingsCategory }
export type SettingsSaveResult = { ok: true; settings: Settings }
  | { ok: false; kind: 'validation'; issues: SettingsIssue[] }
  | { ok: false; kind: 'storage' | 'unavailable'; message: string };

const categoryOf = (key: PropertyKey) => settingsCategories.find(category => (category.keys as readonly PropertyKey[]).includes(key))!.id;

export function settingsConflicts(settings: Settings): SettingsIssue[] {
  return settingsCategories.flatMap(category => 'conflicts' in category
    ? category.conflicts(settings).map(issue => ({ ...issue, category: category.id })) : []);
}

/** The first problem of each invalid field, then every settings conflict, in category order. */
export function settingsIssues(settings: Settings): SettingsIssue[] {
  const fields = new Map<string, SettingsIssue>();
  for (const issue of saveSchema.safeParse(settings).error?.issues ?? []) {
    const field = issue.path.filter(segment => typeof segment === 'string').join('.');
    if (!fields.has(field)) fields.set(field, { field, category: categoryOf(issue.path[0]),
      code: issue.code === 'custom' && issue.params?.code === 'required' ? 'required' : 'invalid', message: issue.message });
  }
  const order = (issue: SettingsIssue) => settingsCategories.findIndex(category => category.id === issue.category);
  return [...fields.values(), ...settingsConflicts(settings)].sort((a, b) => order(a) - order(b));
}

export function settingsPatch(draft: Settings, categories: readonly SettingsCategory[]): Partial<Settings> {
  return Object.fromEntries(settingsCategories.filter(category => categories.includes(category.id))
    .flatMap(category => category.keys.map(key => [key, draft[key]])));
}

export function dirtySettingsCategories(draft: Settings, saved: Settings): SettingsCategory[] {
  return settingsCategories.filter(category => category.keys.some(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))).map(category => category.id);
}
