import type {
  Sidebar,
  SidebarPreferences,
  AgentType,
  CommandCheck,
  DirectoryResult,
  Layout,
  ProjectCreation,
  PanelCreation,
  ProjectDraft,
  ProjectEdit,
  ProjectEditResult,
  Settings,
  Snapshot,
  WorkbenchEvent,
} from './model';
import type { SettingsSaveResult } from './settings/settings';
import type { DispatchRequest } from './dispatch';
import type { Delivery } from './settings/workflows';
import type { DirectAction, DirectActionResult, RepositoryChoices, RepositoryReference } from './forge/forge';
import type { DetailItem, ForgeListView, ForgeSidebarPresence } from './forge/sidebar-data';

export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<ProjectCreation>;
  /** Saves name, directory and Repository Binding together, or none of them. */
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult>;
  deleteProject(id: string): Promise<void>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  /** The repositories the project can bind, with the one the origin of `directory` points at; or a forge failure. The
   * edit-project dialog reads them for a directory being edited; the Forge sidebar uses `showRepositoryChoices`. */
  repositoryChoices(projectId: string, directory: string): Promise<RepositoryChoices>;
  /** Binds or rebinds the project to a repository its forge lists; the list is read again first, and when it cannot be
   * read or does not show the repository, nothing is written and it rejects with the reason. */
  bindRepository(projectId: string, repository: RepositoryReference): Promise<void>;
  /** Unbinds the project; it needs no forge CLI. */
  unbindRepository(projectId: string): Promise<void>;
  /** Declares that the Forge sidebar shows the project's lists on `view`; the main process pushes the rows it keeps for
   * that view at once, and loads or updates them, as `forgeLists` events. Resolves once they settled. */
  showForgeList(projectId: string, view: ForgeListView): Promise<void>;
  /** Reports whether the Forge sidebar shows the project's lists and whether the window is in the foreground; the main
   * process updates them in the background when they come to show. A hidden project's detail closes. */
  reportForgeSidebarPresence(presence: ForgeSidebarPresence): Promise<void>;
  /** Appends the next page of the rows shown, in the filter that produced them. */
  loadMoreForgeList(projectId: string): Promise<void>;
  /** Declares the numbers of the shown tab's rows the Forge sidebar renders. */
  showForgeRows(projectId: string, numbers: number[]): Promise<void>;
  /** Reloads the shown tab from its first page through the page holding the last row the sidebar renders, replacing
   * its rows, and the open detail. */
  refreshForgeList(projectId: string): Promise<void>;
  /** Declares that a binding page of the Forge sidebar shows the repositories the project can bind; they are read once
   * per call and pushed as `repositoryChoices` events. */
  showRepositoryChoices(projectId: string): Promise<void>;
  /** Declares the item the Forge sidebar's detail shows, or null when it closes; the main process pushes a kept answer
   * at once, loads it on each call (unless it was read ahead and not opened since), and pushes it as `forgeDetail` events.
   * Resolves once it settled. */
  showForgeDetail(projectId: string, item: DetailItem | null): Promise<void>;
  /** Reports the list row the pointer or keyboard focus rests on, or null when it left the rows; once it rested 150ms
   * while the sidebar shows the project in the foreground, the main process reads the row's detail ahead into the kept
   * details. */
  reportForgeRowResting(projectId: string, item: DetailItem | null): Promise<void>;
  /** Reports that a direct action or dispatch changed `item`; the main process reloads its detail and shows the new
   * state in the open detail and the item's list row. */
  reportForgeItemChanged(projectId: string, item: DetailItem): Promise<void>;
  /** Closes, reopens or merges an issue or pull request of the project's bound repository; the forge's text comes back either way. */
  directAction(projectId: string, action: DirectAction): Promise<DirectActionResult>;
  /** Dispatches an issue of the project's bound repository to a panel with a run, or to a new panel that joins the tray:
   * the command goes into its terminal and a Dispatch Record joins the snapshot once the run is on a session. Resolves
   * with the delivery used and the panel that took the dispatch. */
  dispatch(projectId: string, request: DispatchRequest): Promise<{ delivery: Delivery; panelId: string }>;
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
declare global {
  interface Window {
    workbench: DesktopAPI;
  }
}
