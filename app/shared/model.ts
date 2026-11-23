import { z } from 'zod';
import { message, type MessageId } from './messages';
import type { Shortcuts } from './settings/shortcuts';
import { rejectProjectName } from './project-name';
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
export type AgentCommand = {
  command: string;
  args: string[];
};
export const defaultLayouts = ['auto', 'row', 'column'] as const;
export type DefaultLayout = (typeof defaultLayouts)[number];
export const languages = ['en', 'zh-CN'] as const;
export type Language = (typeof languages)[number];
export type SidebarCoexistence = 'squeeze' | 'overlay';
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
export const isLiveRun = (run?: Run) => run?.state === 'running' || run?.state === 'starting';
export type LaunchResult =
  | { outcome: 'started'; run: Run; agent: AgentType }
  | { outcome: 'failed'; run: Run; agent: AgentType }
  | { outcome: 'unconfirmed'; run: Run; agent: AgentType; reason: string };
export interface ProjectCreation {
  project: Project;
  launches: LaunchResult[];
}
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
export interface SidebarPreferences {
  visible: boolean;
  width: number;
}
export const sidebarPreferencesSchema = z.strictObject({ visible: z.boolean(), width: z.number() });
export const sidebars = {
  navigation: { defaults: { visible: true, width: 212 }, minWidth: 168, invalidMessage: 'navigationInvalid' },
  forgeSidebar: { defaults: { visible: false, width: 380 }, minWidth: 300, invalidMessage: 'forgeSidebarInvalid' },
} as const satisfies Record<Sidebar, { defaults: SidebarPreferences; minWidth: number; invalidMessage: MessageId }>;
const sidebarIds = ['navigation', 'forgeSidebar'] as const;
export type Sidebar = (typeof sidebarIds)[number];
export const sidebarSchema = z.enum(sidebarIds);
export type PanelView = Panel & { run?: Run; status?: ProcessingState };
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
export type DirectoryProblem =
  { kind: 'missing' } | { kind: 'notDirectory' } | { kind: 'duplicate'; projectId: string; projectName: string };
export type DirectoryInspection =
  { ok: true; directory: string; name: string } | { ok: false; problem: DirectoryProblem };

export function assignedAgents(draft: ProjectDraft): AgentType[] {
  return agentTypes.flatMap(type => Array.from({ length: draft.counts[type] }, () => type));
}

export function validateDraft(draft: ProjectDraft): void {
  rejectProjectName(draft.name);
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
export const layoutSchema = layoutNodeSchema.refine(layout => layoutDepth(layout) <= 10);

export const layoutPanelIds = (layout: Layout | null): string[] => (layout ? panelIds(layout) : []);

export const panelLimit = 10;
export const projectPanels = <P extends Panel>({ panels, tray }: { panels: P[]; tray: P[] }) => [...panels, ...tray];
export const panelLimitReached = (project: { panels: Panel[]; tray: Panel[] }) =>
  projectPanels(project).length >= panelLimit;

export function panelPath(layout: Layout | null, panelId: string): ('first' | 'second')[] | null {
  if (!layout) return null;
  if ('panel' in layout) return layout.panel === panelId ? [] : null;
  const first = panelPath(layout.first, panelId);
  if (first) return ['first', ...first];
  const second = panelPath(layout.second, panelId);
  return second && ['second', ...second];
}

export function parseLayoutStructure(value: unknown): Layout | null {
  const parsed = layoutSchema.nullable().safeParse(value);
  if (!parsed.success) throw new Error(message('layoutInvalid'));
  return parsed.data;
}

export function parseLayout(value: unknown, panels: Panel[]): Layout | null {
  const layout = parseLayoutStructure(value);
  const ids = layoutPanelIds(layout);
  if (ids.length !== panels.length || new Set(ids).size !== ids.length || panels.some(p => !ids.includes(p.id)))
    throw new Error(message('layoutMismatch'));
  return layout;
}
