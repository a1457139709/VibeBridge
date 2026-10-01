// THROWAWAY contract sketch. No Electron, PTY, filesystem or SQLite operations.
export type AgentType = 'codex' | 'claude' | 'pi';
export type Variant = 'A' | 'B' | 'C';
export type Theme = 'system' | 'dark' | 'light';
export type Panel = { id: string; agent: AgentType; runId: string | null };
export type Layout =
  | { kind: 'panel'; panelId: string }
  | { kind: 'split'; id: string; axis: 'x' | 'y'; ratio: number; first: Layout; second: Layout };
export type Project = {
  id: string;
  name: string;
  directory: string;
  initials: string;
  color: string;
  panels: Panel[];
  layout: Layout | null;
  opened: boolean;
};
export type AgentSettings = Record<AgentType, { command: string; args: string }>;
export type ShortcutAction = 'nextProject' | 'nextPanel' | 'maximize' | 'addAgent';
export type Shortcuts = Record<ShortcutAction, string>;
export type WorkspaceSnapshot = {
  activeProjectId: string;
  projects: Array<Omit<Project, 'opened' | 'panels'> & { panels: Array<Omit<Panel, 'runId'>> }>;
  agentSettings: AgentSettings;
  theme: Theme;
  shortcuts: Shortcuts;
};
export type PrototypeCommand =
  | { type: 'directory.select' }
  | { type: 'agent.check'; agent: AgentType; command: string }
  | { type: 'run.start'; projectId: string; panelId: string; runId: string; agent: AgentType; cwd: string; command: string; args: string }
  | { type: 'run.input'; runId: string; data: string }
  | { type: 'run.resize'; runId: string; cols: number; rows: number }
  | { type: 'run.stop'; runId: string; reason: 'panel-close' | 'process-exit' | 'app-quit' | 'main-crash' }
  | { type: 'workspace.save'; snapshot: WorkspaceSnapshot }
  | { type: 'window.ensure-size'; projectId: string; width: number; height: number }
  | { type: 'app.quit' };
export type PrototypeEvent =
  | { type: 'run.output'; runId: string; data: string }
  | { type: 'run.exit'; runId: string; exitCode: number }
  | { type: 'run.start-failed'; runId: string }
  | { type: 'agent.check-result'; agent: AgentType; available: boolean };
export type Trace = {
  sequence: number;
  time: string;
  direction: 'command' | 'event' | 'ui';
  type: string;
  payload: unknown;
};
