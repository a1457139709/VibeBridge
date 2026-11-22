import { z } from 'zod';
import { message } from '../messages';
import { agentNames, agentTypeSchema, defaultLayouts, languages, type AgentType, type Settings } from '../model';
import {
  defaultDelivery,
  defaultWorkflowSettings,
  deliveries,
  workflows,
  workflowsById,
  type Workflow,
  type WorkflowId,
} from './workflows';
import {
  defaultShortcuts,
  shortcutActions,
  shortcutConflicts,
  shortcutConflictMessage,
  shortcutFormatError,
  type ShortcutAction,
} from './shortcuts';

export const defaultSettings = (): Settings => ({
  language: 'en',
  theme: 'system',
  defaultLayout: 'auto',
  sidebarCoexistence: 'squeeze',
  detailCoexistence: 'overlay',
  shortcuts: defaultShortcuts(),
  agents: {
    codex: { command: 'codex', args: [] },
    claude: { command: 'claude', args: [] },
    pi: { command: 'pi', args: [] },
  },
  workflows: defaultWorkflowSettings(),
});

interface FieldIssue {
  field: string;
  code: 'required' | 'invalid' | 'conflict';
  message: string;
}

const command = (type: AgentType) =>
  z
    .string({ error: message('commandInvalid', { agent: agentNames[type] }) })
    .refine(command => command.trim(), { error: message('commandRequired'), params: { code: 'required' } });
const args = z.array(z.string({ error: message('argumentsInvalid') }), { error: message('argumentsInvalid') });
const shortcut = z
  .string({ error: message('shortcutInvalid') })
  .refine(binding => !shortcutFormatError(binding), { error: message('shortcutInvalid') });

// The single definition of valid settings. Reading falls back to each field's default, so its
// result is always valid; saving reports each invalid field. Unknown keys pass through both.
function settingsSchema(reading: boolean) {
  const defaults = defaultSettings();
  const field = <T extends z.ZodType>(schema: T, fallback: z.output<T>) => (reading ? schema.catch(fallback) : schema);
  const object = <T extends z.ZodRawShape>(shape: T, error: string) => z.looseObject(shape, { error });
  const agentSettings = (type: AgentType) =>
    field(
      object(
        { command: field(command(type), defaults.agents[type].command), args: field(args, []) },
        message('commandInvalid', { agent: agentNames[type] }),
      ),
      defaults.agents[type],
    );
  const shortcutSetting = (action: ShortcutAction) => field(shortcut, defaults.shortcuts[action]);
  const workflowSettings = (workflow: Workflow & { id: WorkflowId }) =>
    field(
      object(
        {
          enabled: field(z.boolean({ error: message('workflowsInvalid') }), defaults.workflows[workflow.id].enabled),
          commands: field(
            object(
              Object.fromEntries(
                workflow.commands.map(command => [
                  command.id,
                  field(
                    object(
                      { delivery: field(z.enum(deliveries, { error: message('workflowsInvalid') }), defaultDelivery) },
                      message('workflowsInvalid'),
                    ),
                    defaults.workflows[workflow.id].commands[command.id],
                  ),
                ]),
              ),
              message('workflowsInvalid'),
            ),
            defaults.workflows[workflow.id].commands,
          ),
        },
        message('workflowsInvalid'),
      ),
      defaults.workflows[workflow.id],
    );
  // Each record below names every key of its type, which `satisfies` checks.
  return z.looseObject(
    {
      language: field(z.enum(languages, { error: message('languageInvalid') }), defaults.language),
      theme: field(z.enum(['system', 'dark', 'light'], { error: message('themeInvalid') }), defaults.theme),
      defaultLayout: field(
        z.enum(defaultLayouts, { error: message('layoutPreferenceInvalid') }),
        defaults.defaultLayout,
      ),
      sidebarCoexistence: field(
        z.enum(['squeeze', 'overlay'], { error: message('sidebarCoexistenceInvalid') }),
        defaults.sidebarCoexistence,
      ),
      detailCoexistence: field(
        z.enum(['overlay', 'squeeze'], { error: message('detailCoexistenceInvalid') }),
        defaults.detailCoexistence,
      ),
      agents: field(
        object(
          {
            codex: agentSettings('codex'),
            claude: agentSettings('claude'),
            pi: agentSettings('pi'),
          } satisfies Record<AgentType, z.ZodType>,
          message('settingsInvalid'),
        ),
        defaults.agents,
      ),
      shortcuts: field(
        object(
          {
            previousProject: shortcutSetting('previousProject'),
            nextProject: shortcutSetting('nextProject'),
            previousPanel: shortcutSetting('previousPanel'),
            nextPanel: shortcutSetting('nextPanel'),
            maximizePanel: shortcutSetting('maximizePanel'),
            addPanel: shortcutSetting('addPanel'),
            closePanel: shortcutSetting('closePanel'),
            settings: shortcutSetting('settings'),
            toggleForgeSidebar: shortcutSetting('toggleForgeSidebar'),
            openDispatchMenu: shortcutSetting('openDispatchMenu'),
            locateDispatchedPanel: shortcutSetting('locateDispatchedPanel'),
          } satisfies Record<ShortcutAction, z.ZodType>,
          message('shortcutInvalid'),
        ),
        defaults.shortcuts,
      ),
      workflows: field(
        object(
          { matt: workflowSettings(workflowsById.matt) } satisfies Record<WorkflowId, z.ZodType>,
          message('workflowsInvalid'),
        ),
        defaults.workflows,
      ),
    },
    { error: message('settingsCorrupt') },
  );
}
const readSchema = settingsSchema(true);
const saveSchema = settingsSchema(false);

/** The shape of the settings a save is asked to apply: each field present has the type Settings gives it. Whether
 * its value is valid is for the save to report, field by field, so only the shape is checked here. Unknown keys pass
 * through, as they do where settings are read. */
export const settingsPatchSchema = z
  .looseObject({
    language: z.enum(languages),
    theme: z.enum(['system', 'dark', 'light']),
    defaultLayout: z.enum(defaultLayouts),
    sidebarCoexistence: z.enum(['squeeze', 'overlay']),
    detailCoexistence: z.enum(['overlay', 'squeeze']),
    agents: z.looseRecord(agentTypeSchema, z.looseObject({ command: z.string(), args: z.array(z.string()) })),
    shortcuts: z.looseRecord(z.enum(shortcutActions), z.string()),
    workflows: z.looseRecord(
      z.literal(workflows.map(workflow => workflow.id)),
      z.looseObject({
        enabled: z.boolean(),
        commands: z.record(z.string(), z.looseObject({ delivery: z.enum(deliveries) })),
      }),
    ),
  })
  .partial() satisfies z.ZodType<Partial<Settings>>;

/** Settings in the valid domain read from any JSON value; only a value that is not an object is rejected. */
export function readSettings(value: unknown): Settings {
  const result = readSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}

// Navigation, draft selection and validation all follow this definition's order. A category's
// conflicts are relations between fields that are each valid.
export const settingsCategories = [
  { id: 'general', keys: ['language'] },
  { id: 'agents', keys: ['agents'] },
  { id: 'workflows', keys: ['workflows'] },
  { id: 'appearance', keys: ['theme', 'defaultLayout', 'sidebarCoexistence', 'detailCoexistence'] },
  {
    id: 'shortcuts',
    keys: ['shortcuts'],
    conflicts(settings: Settings): FieldIssue[] {
      return shortcutConflicts(settings.shortcuts).flatMap(conflict =>
        conflict.actions.map(action => ({
          field: `shortcuts.${action}`,
          code: 'conflict' as const,
          message: shortcutConflictMessage(conflict, action),
        })),
      );
    },
  },
] as const satisfies readonly {
  id: string;
  keys: readonly (keyof Settings)[];
  conflicts?(settings: Settings): FieldIssue[];
}[];

export type SettingsCategory = (typeof settingsCategories)[number]['id'];
export interface SettingsIssue extends FieldIssue {
  category: SettingsCategory;
}
export type SettingsSaveResult =
  | { ok: true; settings: Settings }
  | { ok: false; kind: 'validation'; issues: SettingsIssue[] }
  | { ok: false; kind: 'storage' | 'unavailable'; message: string };

/** The category a settings key belongs to; every key the schema checks belongs to one. */
function categoryOf(key: PropertyKey): SettingsCategory {
  const category = settingsCategories.find(category => category.keys.some(categoryKey => categoryKey === key));
  if (!category) throw new Error(`Settings key ${String(key)} belongs to no settings category`);
  return category.id;
}

export function settingsConflicts(settings: Settings): SettingsIssue[] {
  return settingsCategories.flatMap(category =>
    'conflicts' in category ? category.conflicts(settings).map(issue => ({ ...issue, category: category.id })) : [],
  );
}

/** The first problem of each invalid field, then every settings conflict, in category order. */
export function settingsIssues(settings: Settings): SettingsIssue[] {
  const fields = new Map<string, SettingsIssue>();
  for (const issue of saveSchema.safeParse(settings).error?.issues ?? []) {
    const field = issue.path.filter(segment => typeof segment === 'string').join('.');
    if (!fields.has(field))
      fields.set(field, {
        field,
        category: categoryOf(issue.path[0]),
        code: issue.code === 'custom' && issue.params?.code === 'required' ? 'required' : 'invalid',
        message: issue.message,
      });
  }
  const order = (issue: SettingsIssue) => settingsCategories.findIndex(category => category.id === issue.category);
  return [...fields.values(), ...settingsConflicts(settings)].sort((a, b) => order(a) - order(b));
}

export function settingsPatch(draft: Settings, categories: readonly SettingsCategory[]): Partial<Settings> {
  return Object.fromEntries(
    settingsCategories
      .filter(category => categories.includes(category.id))
      .flatMap(category => category.keys.map(key => [key, draft[key]])),
  );
}

export function dirtySettingsCategories(draft: Settings, saved: Settings): SettingsCategory[] {
  return settingsCategories
    .filter(category => category.keys.some(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key])))
    .map(category => category.id);
}
