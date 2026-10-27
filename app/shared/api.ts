import type { NavigationPreferences, AgentType, CommandCheck, DirectoryResult, Layout, ProjectCreation, PanelCreation, ProjectDraft, ProjectEdit, ProjectEditResult, Settings, Snapshot, WorkbenchEvent } from './model';
import type { SettingsSaveResult } from './settings';

export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<ProjectCreation>;
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult>;
  deleteProject(id: string): Promise<void>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  chooseDirectory(): Promise<string | null>;
  activateProject(id: string): Promise<void>;
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation>;
  closePanel(projectId: string, panelId: string): Promise<void>;
  saveLayout(projectId: string, layout: Layout | null): Promise<void>;
  saveNavigation(preferences: NavigationPreferences): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<SettingsSaveResult>;
  checkCommand(command: string): Promise<CommandCheck>;
  sendInput(runId: string, data: string): Promise<void>;
  resizeRun(runId: string, cols: number, rows: number): Promise<void>;
  acknowledgeOutput(runId: string, characters: number): void;
  subscribe(listener: (event: WorkbenchEvent) => void): () => void;
  ready(): Promise<void>;
  /** Starts the same confirmed quit as the application menu. */
  quit(): Promise<void>;
}
declare global { interface Window { workbench: DesktopAPI } }
