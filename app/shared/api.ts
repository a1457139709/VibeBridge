import type { Sidebar, SidebarPreferences, AgentType, CommandCheck, DirectoryResult, Layout, ProjectCreation, PanelCreation, ProjectDraft, ProjectEdit, ProjectEditResult, Settings, Snapshot, WorkbenchEvent } from './model';
import type { SettingsSaveResult } from './settings';
import type { IssueDetailResult, PullRequestDetailResult, IssuePage, ListQuery, PullRequestPage, RepositoryChoices } from './forge';

export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<ProjectCreation>;
  /** Saves name, directory and Repository Binding together, or none of them. */
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult>;
  deleteProject(id: string): Promise<void>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  /** The repositories the project can bind, with the one the origin of `directory` points at; or a forge failure. */
  repositoryChoices(projectId: string, directory: string): Promise<RepositoryChoices>;
  /** One page of the issues of the project's bound repository, filtered by the forge; or a forge failure. */
  issuePage(projectId: string, query: ListQuery): Promise<IssuePage>;
  /** One page of the pull requests of the project's bound repository, filtered by the forge; or a forge failure. */
  pullRequestPage(projectId: string, query: ListQuery): Promise<PullRequestPage>;
  /** One issue of the project's bound repository with its rendered body, comments and relations; or a forge failure. */
  issueDetail(projectId: string, number: number): Promise<IssueDetailResult>;
  pullRequestDetail(projectId: string, number: number): Promise<PullRequestDetailResult>;
  chooseDirectory(): Promise<string | null>;
  activateProject(id: string): Promise<void>;
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation>;
  closePanel(projectId: string, panelId: string): Promise<void>;
  /** Makes a tray panel resident with the target layout; a swap sends the replaced resident panel to the tray. */
  placeInLayout(projectId: string, panelId: string, layout: Layout): Promise<void>;
  /** Makes a resident panel ephemeral; the other resident panels fill its space. */
  moveToTray(projectId: string, panelId: string): Promise<void>;
  saveLayout(projectId: string, layout: Layout | null): Promise<void>;
  /** Saves a sidebar's open state and width, shared by the whole app. */
  saveSidebar(sidebar: Sidebar, preferences: SidebarPreferences): Promise<void>;
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
