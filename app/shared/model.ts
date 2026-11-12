import { z } from 'zod';
import { message } from './messages';
import type { Shortcuts } from './shortcuts';
import { projectNameError } from './project-name';
import type { ProcessingState } from './processing-status';
import type { SettingsIssue } from './settings';
import type { ForgePresentation, RepositoryReference } from './forge';

export const agentTypes = ['codex', 'claude', 'pi'] as const;
export type AgentType = typeof agentTypes[number];
export const agentTypeSchema = z.enum(agentTypes);
export const agentNames: Record<AgentType, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'pi' };
export interface ProjectDraft { name: string; directory: string; total: number; counts: Record<AgentType, number> }
export const newDraft = (): ProjectDraft => ({ name: '', directory: '', total: 3, counts: { codex: 0, claude: 0, pi: 0 } });
export interface Panel { id: string; agent: AgentType }
export type Layout = { panel: string } | { axis: 'row' | 'column'; ratio: number; first: Layout; second: Layout };
export interface Project { id: string; name: string; directory: string; panels: Panel[]; layout: Layout | null }
export interface AgentCommand { command: string; args: string[] }
export type DefaultLayout = 'auto' | 'row' | 'column';
export type Language = 'en' | 'zh-CN';
/** Whether the open issue sidebar squeezes the layout area or overlays it. */
export type SidebarCoexistence = 'squeeze' | 'overlay';
export interface Settings { language: Language; theme: 'system' | 'dark' | 'light'; defaultLayout: DefaultLayout; sidebarCoexistence: SidebarCoexistence; agents: Record<AgentType, AgentCommand>; shortcuts: Shortcuts }
export type CommandCheck = { available: true; path: string } | { available: false; message: string };
export interface Run { id: string; projectId: string; panelId: string; state: 'running' | 'starting' | 'failed' | 'stopped'; pid?: number; title?: string }
// An unconfirmed launch may still be running; only a failed one is known not to have started.
export type LaunchResult = { outcome: 'started'; run: Run; agent: AgentType } | { outcome: 'failed'; run: Run; agent: AgentType }
  | { outcome: 'unconfirmed'; run: Run; agent: AgentType; reason: string };
export interface ProjectCreation { project: Project; launches: LaunchResult[] }
/** Everything the edit-project form saves: `repository` is the Repository Binding the project has afterwards, null for none. */
export interface ProjectEdit { name: string; directory: string; repository: RepositoryReference | null }
export interface ProjectEditResult { project: Project; launches: LaunchResult[]; error?: string }
export interface PanelCreation { panel: Panel; launch: LaunchResult }
export interface NavigationPreferences { visible: boolean; width: number }
export const defaultNavigation: NavigationPreferences = { visible: true, width: 212 };
// Width bounds belong to the interaction that sets them (navigationWidth), not to the stored format.
export const navigationSchema = z.strictObject({ visible: z.boolean(), width: z.number() });
export const navigationWidth = (width: number) => Math.max(168, Math.min(420, width));
/** The issue sidebar's open state and width, one for the whole app. Stored like NavigationPreferences. */
export interface IssueSidebarPreferences { visible: boolean; width: number }
export const defaultIssueSidebar: IssueSidebarPreferences = { visible: false, width: 380 };
export const issueSidebarSchema = z.strictObject({ visible: z.boolean(), width: z.number() });
export const issueSidebarWidth = (width: number) => Math.max(300, Math.min(560, width));
/** A panel with its current run, whatever that run's state, and the processing state it displays. */
export type PanelView = Panel & { run?: Run; status?: ProcessingState };
/** A project as the snapshot shows it. `panels` are its resident panels, placed by `layout`;
 * `tray` holds its ephemeral panels in the order they joined. The stored Project keeps only
 * the resident panels' configuration and layout; the tray lives in memory for one app run.
 * `repository` is its Repository Binding, stored apart from the project, or null when unbound; `forge` is the
 * Forge its issue sidebar shows: the bound one, else the one an unbound project binds from. */
export type ProjectView = Omit<Project, 'panels'> & { panels: PanelView[]; tray: PanelView[]; repository: RepositoryReference | null; forge: ForgePresentation };
export interface Snapshot { navigation: NavigationPreferences; issueSidebar: IssueSidebarPreferences; projects: ProjectView[]; activeProjectId: string | null; settings: Settings; settingsConflicts: SettingsIssue[]; startupTheme: Settings['theme']; resolvedTheme: 'dark' | 'light'; errors: string[] }
export type TerminalEvent = { kind: 'title'; runId: string; title: string } | { kind: 'output'; runId: string; data: string } | { kind: 'started'; run: Run } | { kind: 'stopping'; runId: string } | { kind: 'exit'; runId: string };
export type WorkbenchEvent = Extract<TerminalEvent, { kind: 'started' | 'output' | 'exit' }> | { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'error'; message: string };
export interface DirectoryResult { valid: boolean; directory?: string; name?: string; existingProjectId?: string; existingProjectName?: string }

export function assignedAgents(draft: ProjectDraft): AgentType[] {
  return agentTypes.flatMap(type => Array.from({ length: draft.counts[type] }, () => type));
}

export function validateDraft(draft: ProjectDraft): void {
  const nameError = projectNameError(draft.name);
  if (nameError) throw new Error(nameError);
  if (!Number.isInteger(draft.total) || draft.total < 1 || draft.total > 10) throw new Error(message('windowCountInvalid'));
  if (agentTypes.some(type => !Number.isInteger(draft.counts[type]) || draft.counts[type] < 0 || draft.counts[type] > 10)
    || agentTypes.reduce((sum, type) => sum + draft.counts[type], 0) !== draft.total) throw new Error(message('assignmentInvalid'));
}

export function arrange(ids: string[], preference: DefaultLayout = 'auto'): Layout | null {
  if (!ids.length) return null;
  if (ids.length === 1) return { panel: ids[0] };
  if (preference !== 'auto') return { axis: preference, ratio: 1 / ids.length, first: { panel: ids[0] }, second: arrange(ids.slice(1), preference)! };
  if (ids.length === 3) return { axis: 'column', ratio: 0.58, first: { panel: ids[0] }, second: { axis: 'row', ratio: 0.5, first: { panel: ids[1] }, second: { panel: ids[2] } } };
  const half = Math.ceil(ids.length / 2);
  return { axis: ids.length > 2 ? 'column' : 'row', ratio: half / ids.length, first: arrange(ids.slice(0, half))!, second: arrange(ids.slice(half))! };
}

export function removeFromLayout(layout: Layout | null, panelId: string): Layout | null {
  if (!layout) return null;
  if ('panel' in layout) return layout.panel === panelId ? null : layout;
  const first = removeFromLayout(layout.first, panelId), second = removeFromLayout(layout.second, panelId);
  return first && second ? { ...layout, first, second } : first ?? second;
}

const layoutNodeSchema: z.ZodType<Layout> = z.lazy(() => z.union([
  z.strictObject({ panel: z.string() }),
  z.strictObject({ axis: z.enum(['row', 'column']), ratio: z.number().gt(0).lt(1), first: layoutNodeSchema, second: layoutNodeSchema }),
]));
const layoutDepth = (node: Layout): number => 'panel' in node ? 0 : 1 + Math.max(layoutDepth(node.first), layoutDepth(node.second));
const panelIds = (node: Layout): string[] => 'panel' in node ? [node.panel] : [...panelIds(node.first), ...panelIds(node.second)];
const layoutSchema = layoutNodeSchema.refine(layout => layoutDepth(layout) <= 10).nullable();

/** The panel IDs a layout places, in order. */
export const layoutPanelIds = (layout: Layout | null): string[] => layout ? panelIds(layout) : [];

/** A project holds at most this many panels, resident and tray together. */
export const panelLimit = 10;
/** Every panel of a project: its resident panels, then its tray panels in tray order. */
export const projectPanels = <P extends Panel>({ panels, tray }: { panels: P[]; tray: P[] }) => [...panels, ...tray];
export const panelLimitReached = (project: { panels: Panel[]; tray: Panel[] }) => projectPanels(project).length >= panelLimit;

/** The branch path from the root to a panel in a layout, or null when the layout does not place it. */
export function panelPosition(layout: Layout | null, panelId: string): ('first' | 'second')[] | null {
  if (!layout) return null;
  if ('panel' in layout) return layout.panel === panelId ? [] : null;
  const first = panelPosition(layout.first, panelId);
  if (first) return ['first', ...first];
  const second = panelPosition(layout.second, panelId);
  return second && ['second', ...second];
}

/** A layout whose structure is valid, whichever panels it places. */
export function layoutStructure(value: unknown): Layout | null {
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) throw new Error(message('layoutInvalid'));
  return parsed.data;
}

/** A layout of the given panels: its structure is valid and it places each panel exactly once. */
export function parseLayout(value: unknown, panels: Panel[]): Layout | null {
  const layout = layoutStructure(value);
  const ids = layoutPanelIds(layout);
  if (ids.length !== panels.length || new Set(ids).size !== ids.length || panels.some(p => !ids.includes(p.id))) throw new Error(message('layoutMismatch'));
  return layout;
}
