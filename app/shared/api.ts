import type { IssueSidebarPreferences, NavigationPreferences, AgentType, CommandCheck, DirectoryResult, Layout, ProjectCreation, PanelCreation, ProjectDraft, ProjectEdit, ProjectEditResult, Settings, Snapshot, WorkbenchEvent } from './model';
import type { SettingsSaveResult } from './settings';
import type { DispatchRequest } from './dispatch';
import type { IssueFilter, IssuePageResult, MergeRequestPageResult, RepositoryChoices, RepositoryReference } from './code-hosting';

export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<ProjectCreation>;
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult>;
  deleteProject(id: string): Promise<void>;
  /** The repositories the project may bind, with the one its directory's `origin` points to, or why the platform cannot list them. */
  repositoryChoices(projectId: string): Promise<RepositoryChoices>;
  /** Binds one of the project's repository choices; null removes the binding. */
  bindRepository(projectId: string, repository: RepositoryReference | null): Promise<void>;
  /** One page of the issues of the project's bound repository, or why the platform could not read it; a null cursor reads the first page. */
  issuePage(projectId: string, filter: IssueFilter, cursor: string | null): Promise<IssuePageResult>;
  /** Pastes an instruction for an issue of the bound repository into a panel's terminal and records the dispatch on its session. */
  dispatch(projectId: string, request: DispatchRequest): Promise<void>;
  /** One page of the merge requests of the project's bound repository, as `issuePage` reads issues. */
  mergeRequestPage(projectId: string, filter: IssueFilter, cursor: string | null): Promise<MergeRequestPageResult>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  chooseDirectory(): Promise<string | null>;
  activateProject(id: string): Promise<void>;
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation>;
  closePanel(projectId: string, panelId: string): Promise<void>;
  /** Makes a tray panel resident with the target layout; a swap sends the replaced resident panel to the tray. */
  placeInLayout(projectId: string, panelId: string, layout: Layout): Promise<void>;
  /** Makes a resident panel ephemeral; the other resident panels fill its space. */
  moveToTray(projectId: string, panelId: string): Promise<void>;
  saveLayout(projectId: string, layout: Layout | null): Promise<void>;
  saveNavigation(preferences: NavigationPreferences): Promise<void>;
  saveIssueSidebar(preferences: IssueSidebarPreferences): Promise<void>;
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
