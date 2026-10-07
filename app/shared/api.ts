import type { AgentType, DirectoryResult, Layout, Project, ProjectDraft, Snapshot, WorkbenchEvent } from './model';

export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<Project>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  chooseDirectory(): Promise<string | null>;
  activateProject(id: string): Promise<void>;
  addPanel(projectId: string, agent: AgentType): Promise<void>;
  closePanel(projectId: string, panelId: string): Promise<void>;
  saveLayout(projectId: string, layout: Layout | null): Promise<void>;
  sendInput(runId: string, data: string): Promise<void>;
  resizeRun(runId: string, cols: number, rows: number): Promise<void>;
  subscribe(listener: (event: WorkbenchEvent) => void): () => void;
  ready(): Promise<void>;
}
declare global { interface Window { workbench: DesktopAPI } }
