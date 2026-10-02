export type AgentType = 'codex' | 'claude' | 'pi';
export type ThemePreference = 'system' | 'dark' | 'light';
export type AgentInfo = { id: AgentType; name: string; path: string | null; version: string };
export type Boot = { cwd: string; agents: AgentInfo[]; savedTheme: ThemePreference; electron: string; node: string; chrome: string; platform: string; hostPid: number };
export type TerminalEvent =
  | { type: 'output'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
  | { type: 'error'; id: string; message: string };
export type TerminalAPI = {
  boot(): Promise<Boot>;
  saveTheme(theme: ThemePreference): Promise<void>;
  start(options: { id: string; agent: AgentType; cols: number; rows: number }): Promise<{ pid: number }>;
  input(id: string, data: string, binary?: boolean): void;
  resize(id: string, cols: number, rows: number): void;
  stop(id: string): Promise<void>;
  onEvent(callback: (event: TerminalEvent) => void): () => void;
  copy(text: string): Promise<void>;
};
declare global { interface Window { terminalPrototype: TerminalAPI } }
