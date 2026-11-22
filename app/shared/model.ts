import { z } from 'zod';
import { message, type MessageId } from './messages';
import type { Shortcuts } from './settings/shortcuts';
import { projectNameError } from './project-name';
import type { ProcessingState } from './processing-status';
import type { SettingsIssue } from './settings/settings';
import type { WorkflowId, WorkflowSettings } from './settings/workflows';
import type { ForgeCapabilities, ForgePresentation, RepositoryReference } from './forge/forge';
import type { DispatchRecordView } from './dispatch';
import type { ForgeSidebarEvent } from './forge/sidebar-data';

export const agentTypes = ['codex', 'claude', 'pi'] as const;
export type AgentType = (typeof agentTypes)[number];
export const agentTypeSchema = z.enum(agentTypes);
export const agentNames: Record<AgentType, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'pi' };
export interface ProjectDraft {
  name: string;
  directory: string;
  total: number;
  counts: Record<AgentType, number>;
}
export const newDraft = (): ProjectDraft => ({
  name: '',
  directory: '',
  total: 3,
  counts: { codex: 0, claude: 0, pi: 0 },
});
export interface Panel {
  id: string;
  agent: AgentType;
}
export type Layout = { panel: string } | { axis: 'row' | 'column'; ratio: number; first: Layout; second: Layout };
export interface Project {
  id: string;
  name: string;
  directory: string;
  panels: Panel[];
  layout: Layout | null;
}
// Type aliases rather than interfaces: the settings schema's loose objects carry an index signature.
export type AgentCommand = {
  command: string;
  args: string[];
};
/** The layouts a project's panels can start in, as the settings offer them. */
export const defaultLayouts = ['auto', 'row', 'column'] as const;
export type DefaultLayout = (typeof defaultLayouts)[number];
/** The interface languages, as the settings offer them. */
export const languages = ['en', 'zh-CN'] as const;
export type Language = (typeof languages)[number];
/** Whether the open forge sidebar squeezes the layout area or overlays it. */
export type SidebarCoexistence = 'squeeze' | 'overlay';
/** Whether an open issue or pull request detail overlays the layout area or squeezes it. */
export type DetailCoexistence = 'overlay' | 'squeeze';
export interface Settings {
  language: Language;
  theme: 'system' | 'dark' | 'light';
  defaultLayout: DefaultLayout;
  sidebarCoexistence: SidebarCoexistence;
  detailCoexistence: DetailCoexistence;
  agents: Record<AgentType, AgentCommand>;
  shortcuts: Shortcuts;
  workflows: Record<WorkflowId, WorkflowSettings>;
}
export type CommandCheck = { available: true; path: string } | { available: false; message: string };
export interface Run {
  id: string;
  projectId: string;
  panelId: string;
  state: 'running' | 'starting' | 'failed' | 'stopped';
  pid?: number;
  title?: string;
}
/** A run that is starting or running; it has not failed or stopped. */
export const isLiveRun = (run?: Run) => run?.state === 'running' || run?.state === 'starting';
// An unconfirmed launch may still be running; only a failed one is known not to have started.
export type LaunchResult =
  | { outcome: 'started'; run: Run; agent: AgentType }
  | { outcome: 'failed'; run: Run; agent: AgentType }
  | { outcome: 'unconfirmed'; run: Run; agent: AgentType; reason: string };
export interface ProjectCreation {
  project: Project;
  launches: LaunchResult[];
}
/** Everything the edit-project form saves; the Repository Binding is changed only in the forge sidebar. */
export interface ProjectEdit {
  name: string;
  directory: string;
}
export interface ProjectEditResult {
  project: Project;
  launches: LaunchResult[];
  error?: string;
}
export interface PanelCreation {
  panel: Panel;
  launch: LaunchResult;
}
/** A sidebar's open state and width, one for the whole app. */
export interface SidebarPreferences {
  visible: boolean;
  width: number;
}
export const sidebarPreferencesSchema = z.strictObject({ visible: z.boolean(), width: z.number() });
/** The app's sidebars, each named by its key in the snapshot: its preferences before any are saved, the narrowest
 * width that keeps its content whole, and the message for preferences that cannot be saved. A sidebar has no widest
 * width: the window bounds how it is drawn and dragged, never what is stored. */
export const sidebars = {
  navigation: { defaults: { visible: true, width: 212 }, minWidth: 168, invalidMessage: 'navigationInvalid' },
  forgeSidebar: { defaults: { visible: false, width: 380 }, minWidth: 300, invalidMessage: 'forgeSidebarInvalid' },
} as const satisfies Record<string, { defaults: SidebarPreferences; minWidth: number; invalidMessage: MessageId }>;
export type Sidebar = keyof typeof sidebars;
/** A panel with its current run, whatever that run's state, and the processing state it displays. */
export type PanelView = Panel & { run?: Run; status?: ProcessingState };
/** A project as the snapshot shows it. `panels` are its resident panels, placed by `layout`;
 * `tray` holds its ephemeral panels in the order they joined. The stored Project keeps only
 * the resident panels' configuration and layout; the tray lives in memory for one app run.
 * `repository` is its Repository Binding, stored apart from the project, or null when unbound; `forge` is the
 * Forge its forge sidebar shows: the bound one, else the one an unbound project binds from; `capabilities` are
 * the features that Forge declares, and the sidebar shows only those. `dispatches` are its Dispatch Records for the bound
 * repository, oldest first; records for other repositories stay stored but are not shown. */
export type ProjectView = Omit<Project, 'panels'> & {
  panels: PanelView[];
  tray: PanelView[];
  repository: RepositoryReference | null;
  forge: ForgePresentation;
  capabilities: ForgeCapabilities;
  dispatches: DispatchRecordView[];
};
export interface Snapshot extends Record<Sidebar, SidebarPreferences> {
  projects: ProjectView[];
  activeProjectId: string | null;
  settings: Settings;
  settingsConflicts: SettingsIssue[];
  startupTheme: Settings['theme'];
  resolvedTheme: 'dark' | 'light';
  errors: string[];
}
export type TerminalEvent =
  | { kind: 'title'; runId: string; title: string }
  | { kind: 'output'; runId: string; data: string }
  | { kind: 'started'; run: Run }
  | { kind: 'stopping'; runId: string }
  | { kind: 'exit'; runId: string };
export type WorkbenchEvent =
  | Extract<TerminalEvent, { kind: 'started' | 'output' | 'exit' }>
  | { kind: 'snapshot'; snapshot: Snapshot }
  | { kind: 'error'; message: string }
  | ForgeSidebarEvent;
export interface DirectoryResult {
  valid: boolean;
  directory?: string;
  name?: string;
  existingProjectId?: string;
  existingProjectName?: string;
}

export function assignedAgents(draft: ProjectDraft): AgentType[] {
  return agentTypes.flatMap(type => Array.from({ length: draft.counts[type] }, () => type));
}

export function validateDraft(draft: ProjectDraft): void {
  const nameError = projectNameError(draft.name);
  if (nameError) throw new Error(nameError);
  if (!Number.isInteger(draft.total) || draft.total < 1 || draft.total > 10)
    throw new Error(message('windowCountInvalid'));
  if (
    agentTypes.some(
      type => !Number.isInteger(draft.counts[type]) || draft.counts[type] < 0 || draft.counts[type] > 10,
    ) ||
    agentTypes.reduce((sum, type) => sum + draft.counts[type], 0) !== draft.total
  )
    throw new Error(message('assignmentInvalid'));
}

export function arrange(ids: string[], preference: DefaultLayout = 'auto'): Layout | null {
  return ids.length ? arrangePanels(ids, preference) : null;
}

/** The layout of one or more panels. */
function arrangePanels(ids: string[], preference: DefaultLayout = 'auto'): Layout {
  if (ids.length === 1) return { panel: ids[0] };
  if (preference !== 'auto')
    return {
      axis: preference,
      ratio: 1 / ids.length,
      first: { panel: ids[0] },
      second: arrangePanels(ids.slice(1), preference),
    };
  if (ids.length === 3)
    return {
      axis: 'column',
      ratio: 0.58,
      first: { panel: ids[0] },
      second: { axis: 'row', ratio: 0.5, first: { panel: ids[1] }, second: { panel: ids[2] } },
    };
  const half = Math.ceil(ids.length / 2);
  return {
    axis: ids.length > 2 ? 'column' : 'row',
    ratio: half / ids.length,
    first: arrangePanels(ids.slice(0, half)),
    second: arrangePanels(ids.slice(half)),
  };
}

export function removeFromLayout(layout: Layout | null, panelId: string): Layout | null {
  if (!layout) return null;
  if ('panel' in layout) return layout.panel === panelId ? null : layout;
  const first = removeFromLayout(layout.first, panelId),
    second = removeFromLayout(layout.second, panelId);
  return first && second ? { ...layout, first, second } : (first ?? second);
}

const layoutNodeSchema: z.ZodType<Layout> = z.lazy(() =>
  z.union([
    z.strictObject({ panel: z.string() }),
    z.strictObject({
      axis: z.enum(['row', 'column']),
      ratio: z.number().gt(0).lt(1),
      first: layoutNodeSchema,
      second: layoutNodeSchema,
    }),
  ]),
);
const layoutDepth = (node: Layout): number =>
  'panel' in node ? 0 : 1 + Math.max(layoutDepth(node.first), layoutDepth(node.second));
const panelIds = (node: Layout): string[] =>
  'panel' in node ? [node.panel] : [...panelIds(node.first), ...panelIds(node.second)];
const layoutSchema = layoutNodeSchema.refine(layout => layoutDepth(layout) <= 10).nullable();

/** The panel IDs a layout places, in order. */
export const layoutPanelIds = (layout: Layout | null): string[] => (layout ? panelIds(layout) : []);

/** A project holds at most this many panels, resident and tray together. */
export const panelLimit = 10;
/** Every panel of a project: its resident panels, then its tray panels in tray order. */
export const projectPanels = <P extends Panel>({ panels, tray }: { panels: P[]; tray: P[] }) => [...panels, ...tray];
export const panelLimitReached = (project: { panels: Panel[]; tray: Panel[] }) =>
  projectPanels(project).length >= panelLimit;

/** The branch path from the root to a panel in a layout, or null when the layout does not place it. */
export function panelPath(layout: Layout | null, panelId: string): ('first' | 'second')[] | null {
  if (!layout) return null;
  if ('panel' in layout) return layout.panel === panelId ? [] : null;
  const first = panelPath(layout.first, panelId);
  if (first) return ['first', ...first];
  const second = panelPath(layout.second, panelId);
  return second && ['second', ...second];
}

/** A layout whose structure is valid, whichever panels it places. */
export function parseLayoutStructure(value: unknown): Layout | null {
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) throw new Error(message('layoutInvalid'));
  return parsed.data;
}

/** A layout of the given panels: its structure is valid and it places each panel exactly once. */
export function parseLayout(value: unknown, panels: Panel[]): Layout | null {
  const layout = parseLayoutStructure(value);
  const ids = layoutPanelIds(layout);
  if (ids.length !== panels.length || new Set(ids).size !== ids.length || panels.some(p => !ids.includes(p.id)))
    throw new Error(message('layoutMismatch'));
  return layout;
}
