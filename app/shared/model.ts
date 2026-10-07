export const agentTypes = ['codex', 'claude', 'pi'] as const;
export type AgentType = typeof agentTypes[number];
export const agentNames: Record<AgentType, string> = { codex: 'Codex', claude: 'Claude Code', pi: 'pi' };
export interface ProjectDraft { name: string; directory: string; total: number; counts: Record<AgentType, number> }
export const newDraft = (): ProjectDraft => ({ name: '', directory: '', total: 3, counts: { codex: 0, claude: 0, pi: 0 } });
export interface Panel { id: string; agent: AgentType }
export type Layout = { panel: string } | { axis: 'row' | 'column'; ratio: number; first: Layout; second: Layout };
export interface Project { id: string; name: string; directory: string; panels: Panel[]; layout: Layout | null }
export interface AgentCommand { command: string; args: string[] }
export interface Settings { theme: 'system' | 'dark' | 'light'; agents: Record<AgentType, AgentCommand> }
export interface Run { id: string; projectId: string; panelId: string; state: 'running' | 'failed'; pid?: number }
export interface Snapshot { projects: Project[]; activeProjectId: string | null; runs: Run[]; settings: Settings; errors: string[] }
export type TerminalEvent = { kind: 'output'; runId: string; data: string } | { kind: 'started'; run: Run } | { kind: 'exit'; runId: string };
export type WorkbenchEvent = TerminalEvent | { kind: 'snapshot'; snapshot: Snapshot } | { kind: 'error'; message: string };
export interface DirectoryResult { valid: boolean; directory?: string; name?: string; existingProjectId?: string }

export function assignedAgents(draft: ProjectDraft): AgentType[] {
  return agentTypes.flatMap(type => Array.from({ length: draft.counts[type] }, () => type));
}

export function validateDraft(draft: ProjectDraft): void {
  if (!draft.name.trim()) throw new Error('请输入项目名称');
  if (!Number.isInteger(draft.total) || draft.total < 1 || draft.total > 10) throw new Error('窗口总数须为 1 至 10');
  if (agentTypes.some(type => !Number.isInteger(draft.counts[type]) || draft.counts[type] < 0 || draft.counts[type] > 10)
    || agentTypes.reduce((sum, type) => sum + draft.counts[type], 0) !== draft.total) throw new Error('Agent 分配数量须等于窗口总数');
}

export function arrange(ids: string[]): Layout | null {
  if (!ids.length) return null;
  if (ids.length === 1) return { panel: ids[0] };
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

export function validateLayout(layout: Layout | null, panels: Panel[]): void {
  const ids: string[] = [];
  const visit = (node: Layout, depth: number) => {
    if (!node || depth > 10) throw new Error('布局无效');
    if ('panel' in node) ids.push(node.panel);
    else {
      if (!['row', 'column'].includes(node.axis) || !Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1) throw new Error('布局无效');
      visit(node.first, depth + 1); visit(node.second, depth + 1);
    }
  };
  if (layout) visit(layout, 0);
  if (ids.length !== panels.length || new Set(ids).size !== ids.length || panels.some(p => !ids.includes(p.id))) throw new Error('布局与面板不一致');
}
