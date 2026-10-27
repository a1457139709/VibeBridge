import { message } from './messages';
import { layoutBoxes } from './layout';
import type { Shortcuts } from './shortcuts';
import { projectNameError } from './project-name';
import type { ProcessingProjection } from './processing-status';

export const agentTypes = ['codex', 'claude', 'pi'] as const;
export type AgentType = typeof agentTypes[number];
export const agentNames: Record<AgentType, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'pi' };
export interface ProjectDraft { name: string; directory: string; total: number; counts: Record<AgentType, number> }
export const newDraft = (): ProjectDraft => ({ name: '', directory: '', total: 3, counts: { codex: 0, claude: 0, pi: 0 } });
export interface Panel { id: string; agent: AgentType }
export type Layout = { panel: string } | { axis: 'row' | 'column'; ratio: number; first: Layout; second: Layout };
export interface Project { id: string; name: string; directory: string; panels: Panel[]; layout: Layout | null }
export interface AgentCommand { command: string; args: string[] }
export type DefaultLayout = 'auto' | 'row' | 'column';
export type Language = 'en' | 'zh-CN';
export interface Settings { language: Language; theme: 'system' | 'dark' | 'light'; defaultLayout: DefaultLayout; agents: Record<AgentType, AgentCommand>; shortcuts: Shortcuts }
export type CommandCheck = { available: true; path: string } | { available: false; message: string };
export interface Run { id: string; projectId: string; panelId: string; state: 'running' | 'starting' | 'failed' | 'stopped'; pid?: number; rawTitle?: string }
// An unconfirmed launch may still be running; only a failed one is known not to have started.
export type LaunchResult = { outcome: 'started'; run: Run; agent: AgentType } | { outcome: 'failed'; run: Run; agent: AgentType }
  | { outcome: 'unconfirmed'; run: Run; agent: AgentType; reason: string };
export interface ProjectCreation { project: Project; launches: LaunchResult[] }
export interface ProjectEdit { name: string; directory: string }
export interface ProjectEditResult { project: Project; launches: LaunchResult[]; error?: string }
export interface PanelCreation { panel: Panel; launch: LaunchResult }
export interface NavigationPreferences { visible: boolean; width: number }
export const defaultNavigation: NavigationPreferences = { visible: true, width: 212 };
export const navigationWidth = (width: number) => Math.max(168, Math.min(420, width));
export interface Snapshot { processing: ProcessingProjection; navigation: NavigationPreferences; projects: Project[]; activeProjectId: string | null; runs: Run[]; settings: Settings; settingsMigrationConflict: boolean; startupTheme: Settings['theme']; resolvedTheme: 'dark' | 'light'; errors: string[] }
export type TerminalEvent = { kind: 'title'; runId: string; title: string } | { kind: 'output'; runId: string; data: string } | { kind: 'started'; run: Run } | { kind: 'stopping'; runId: string } | { kind: 'exit'; runId: string };
export type WorkbenchEvent = TerminalEvent | { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'error'; message: string };
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

export function insertIntoLayout(layout: Layout | null, panelId: string): Layout {
  if (!layout) return { panel: panelId };
  let target = { panel: '', area: 0, axis: 'row' as 'row' | 'column' };
  // Split the largest relative region. Selection is independent of focus and terminal grid size.
  for (const [panel, { width, height }] of layoutBoxes(layout).panels) {
    if (width * height > target.area) target = { panel, area: width * height, axis: width >= height ? 'row' : 'column' };
  }
  const insert = (node: Layout): Layout => 'panel' in node
    ? node.panel === target.panel ? { axis: target.axis, ratio: 0.5, first: node, second: { panel: panelId } } : node
    : { ...node, first: insert(node.first), second: insert(node.second) };
  return insert(layout);
}

export function validateLayout(layout: Layout | null, panels: Panel[]): void {
  const ids: string[] = [];
  const visit = (node: Layout, depth: number) => {
    if (!node || depth > 10) throw new Error(message('layoutInvalid'));
    if ('panel' in node) ids.push(node.panel);
    else {
      if (!['row', 'column'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) throw new Error(message('layoutInvalid'));
      visit(node.first, depth + 1); visit(node.second, depth + 1);
    }
  };
  if (layout) visit(layout, 0);
  if (ids.length !== panels.length || new Set(ids).size !== ids.length || panels.some(p => !ids.includes(p.id))) throw new Error(message('layoutMismatch'));
}
