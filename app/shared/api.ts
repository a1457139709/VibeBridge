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
  fetchSnapshot(): Promise<Snapshot>;
  createProject(draft: ProjectDraft): Promise<ProjectCreation>;
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult>;
  deleteProject(id: string): Promise<void>;
  inspectDirectory(directory: string): Promise<DirectoryResult>;
  fetchRepositoryChoices(projectId: string, directory: string): Promise<RepositoryChoices>;
  bindRepository(projectId: string, repository: RepositoryReference): Promise<void>;
  unbindRepository(projectId: string): Promise<void>;
  showForgeList(projectId: string, view: ForgeListView): Promise<void>;
  reportForgeSidebarPresence(presence: ForgeSidebarPresence): Promise<void>;
  loadMoreForgeList(projectId: string): Promise<void>;
  showForgeRows(projectId: string, numbers: number[]): Promise<void>;
  refreshForgeList(projectId: string): Promise<void>;
  showRepositoryChoices(projectId: string): Promise<void>;
  showForgeDetail(projectId: string, item: DetailItem | null): Promise<void>;
  reportForgeRowResting(projectId: string, item: DetailItem | null): Promise<void>;
  reportForgeItemChanged(projectId: string, item: DetailItem): Promise<void>;
  performDirectAction(projectId: string, action: DirectAction): Promise<DirectActionResult>;
  dispatch(projectId: string, request: DispatchRequest): Promise<{ delivery: Delivery; panelId: string }>;
  chooseDirectory(): Promise<string | null>;
  activateProject(id: string): Promise<void>;
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation>;
  closePanel(projectId: string, panelId: string): Promise<void>;
  placeInLayout(projectId: string, panelId: string, layout: Layout): Promise<void>;
  moveToTray(projectId: string, panelId: string): Promise<void>;
  saveLayout(projectId: string, layout: Layout | null): Promise<void>;
  saveSidebar(sidebar: Sidebar, preferences: SidebarPreferences): Promise<void>;
  saveSettings(settings: Partial<Settings>): Promise<SettingsSaveResult>;
  checkCommand(command: string): Promise<CommandCheck>;
  sendInput(runId: string, data: string): Promise<void>;
  resizeRun(runId: string, cols: number, rows: number): Promise<void>;
  acknowledgeOutput(runId: string, characters: number): void;
  subscribe(listener: (event: WorkbenchEvent) => void): () => void;
  reportRendererReady(): Promise<void>;
  quit(): Promise<void>;
}
export type DesktopRequest = Exclude<keyof DesktopAPI, 'subscribe'>;
export const desktopChannels = {
  fetchSnapshot: 'workbench:fetch-snapshot',
  createProject: 'workbench:create-project',
  editProject: 'workbench:edit-project',
  deleteProject: 'workbench:delete-project',
  inspectDirectory: 'workbench:inspect-directory',
  fetchRepositoryChoices: 'workbench:fetch-repository-choices',
  bindRepository: 'workbench:bind-repository',
  unbindRepository: 'workbench:unbind-repository',
  showForgeList: 'workbench:show-forge-list',
  reportForgeSidebarPresence: 'workbench:report-forge-sidebar-presence',
  loadMoreForgeList: 'workbench:load-more-forge-list',
  showForgeRows: 'workbench:show-forge-rows',
  refreshForgeList: 'workbench:refresh-forge-list',
  showRepositoryChoices: 'workbench:show-repository-choices',
  showForgeDetail: 'workbench:show-forge-detail',
  reportForgeRowResting: 'workbench:report-forge-row-resting',
  reportForgeItemChanged: 'workbench:report-forge-item-changed',
  performDirectAction: 'workbench:perform-direct-action',
  dispatch: 'workbench:dispatch',
  chooseDirectory: 'workbench:choose-directory',
  activateProject: 'workbench:activate-project',
  addPanel: 'workbench:add-panel',
  closePanel: 'workbench:close-panel',
  placeInLayout: 'workbench:place-in-layout',
  moveToTray: 'workbench:move-to-tray',
  saveLayout: 'workbench:save-layout',
  saveSidebar: 'workbench:save-sidebar',
  saveSettings: 'workbench:save-settings',
  checkCommand: 'workbench:check-command',
  sendInput: 'workbench:send-input',
  resizeRun: 'workbench:resize-run',
  acknowledgeOutput: 'workbench:acknowledge-output',
  reportRendererReady: 'workbench:renderer-ready',
  quit: 'workbench:quit',
} as const satisfies Record<DesktopRequest, `workbench:${string}`>;
export const workbenchEventChannel = 'workbench:event';
declare global {
  interface Window {
    workbench: DesktopAPI;
  }
}
