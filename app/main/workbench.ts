import { message, nestedMessage } from '../shared/messages';
import { rejectProjectName } from '../shared/project-name';
import type { Language, ProjectEdit, ProjectEditResult } from '../shared/model';
import { randomUUID } from 'node:crypto';
import {
  sidebars,
  sidebarPreferencesSchema,
  type Sidebar,
  type SidebarPreferences,
  assignedAgents,
  arrange,
  validateDraft,
  type AgentType,
  type DirectoryInspection,
  type Layout,
  type Project,
  type ProjectCreation,
  type ProjectDraft,
  type PanelCreation,
  type Settings,
  type Snapshot,
  type WorkbenchEvent,
} from '../shared/model';
import { ProjectStore } from './persistence/storage';
import { SettingsFile, defaultSettings } from './persistence/settings';
import { settingsConflicts, type SettingsSaveResult } from '../shared/settings/settings';
import { RunSupervision } from './runs/run-supervision';
import { ProjectPanels } from './projects/project-panels';
import { inspectDirectory } from './projects/project-directory';
import { type DirectAction, type RepositoryReference } from '../shared/forge/forge';
import { RepositoryBindings } from './forge/repository-bindings';
import { ForgeSidebarData } from './forge/forge-sidebar-data';
import {
  directAction,
  issueDetail,
  issuePage,
  issuesByNumber,
  pullRequestDetail,
  pullRequestPage,
  pullRequestsByNumber,
} from './forge/results';
import { Dispatches, type DispatchRecord } from './dispatch';
import type { DispatchRequest } from '../shared/dispatch';
import { errorMessage } from '../shared/caught-error';

export class WorkbenchOpenError extends Error {
  constructor(
    error: unknown,
    readonly language: Language,
  ) {
    super(errorMessage(error), { cause: error });
  }
}

export class Workbench {
  private state: Omit<Snapshot, 'projects'> & { projects: Project[] } = {
    navigation: { ...sidebars.navigation.defaults },
    forgeSidebar: { ...sidebars.forgeSidebar.defaults },
    projects: [],
    activeProjectId: null,
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'system',
    resolvedTheme: 'light',
    errors: [],
  };
  readonly runs: RunSupervision;
  readonly forgeSidebar: ForgeSidebarData;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private panels: ProjectPanels;
  private bindings: RepositoryBindings;
  private dispatches: Dispatches;
  private quitting = false;
  private quitPromise?: Promise<void>;
  private constructor(
    dataDirectory: string,
    private store: ProjectStore,
    private settingsFile: SettingsFile,
    stored: { bindings: Record<string, RepositoryReference>; dispatches: DispatchRecord[] },
  ) {
    this.bindings = new RepositoryBindings(stored.bindings, store);
    this.forgeSidebar = new ForgeSidebarData({
      issuePage: (projectId, query) => issuePage(this.boundRepository(projectId), query),
      pullRequestPage: (projectId, query) => pullRequestPage(this.boundRepository(projectId), query),
      issuesByNumber: (projectId, numbers) => issuesByNumber(this.boundRepository(projectId), numbers),
      pullRequestsByNumber: (projectId, numbers) => pullRequestsByNumber(this.boundRepository(projectId), numbers),
      repositoryChoices: async projectId => this.fetchRepositoryChoices(projectId, this.project(projectId).directory),
      issueDetail: (projectId, number) => issueDetail(this.boundRepository(projectId), number),
      pullRequestDetail: (projectId, number) => pullRequestDetail(this.boundRepository(projectId), number),
      forge: projectId => this.bindings.view(projectId).forge,
      emit: event => this.emit(event),
    });
    this.runs = new RunSupervision(dataDirectory, {
      onRunsChanged: () => this.publishSnapshot(),
      onTerminalEvent: event => this.emit(event),
      onFailure: message => this.reportError(message),
      onRunExited: run => {
        if (!this.quitting)
          void this.operation(async () => {
            if (!this.runs.isExpected(run)) return;
            await this.panels.remove(this.project(run.projectId), run.panelId);
          }).catch(error => this.reportError(error.message));
      },
    });
    this.panels = new ProjectPanels(
      store,
      this.runs,
      () => this.state.settings.agents,
      () => this.publishSnapshot(),
    );
    this.dispatches = new Dispatches(
      stored.dispatches,
      store,
      this.runs,
      () => this.publishSnapshot(),
      message => this.reportError(message),
    );
  }
  static async open(dataDirectory: string, systemDark = false) {
    const settingsFile = new SettingsFile(dataDirectory);
    let settings = defaultSettings();
    const errors: string[] = [];
    try {
      settings = await settingsFile.read();
    } catch (error) {
      errors.push(errorMessage(error));
    }
    let store: ProjectStore | undefined;
    try {
      store = await ProjectStore.open(dataDirectory);
      const { bindings, dispatches, ...projects } = await store.load();
      const workbench = new Workbench(dataDirectory, store, settingsFile, { bindings, dispatches });
      Object.assign(workbench.state, projects, { settings, settingsConflicts: settingsConflicts(settings), errors });
      workbench.state.startupTheme = settings.theme;
      workbench.state.resolvedTheme =
        workbench.state.startupTheme === 'system' ? (systemDark ? 'dark' : 'light') : workbench.state.startupTheme;
      return workbench;
    } catch (error) {
      await store?.close().catch(() => {});
      throw new WorkbenchOpenError(error, settings.language);
    }
  }
  snapshot(): Snapshot {
    const views = this.state.projects.map(project => ({
      ...project,
      ...this.panels.view(project),
      ...this.bindings.view(project.id),
    }));
    return structuredClone({ ...this.state, projects: this.dispatches.withDispatches(views) });
  }
  subscribe(listener: (event: WorkbenchEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: WorkbenchEvent) {
    for (const listener of this.listeners) listener(event);
  }
  private publishSnapshot() {
    this.emit({ kind: 'snapshot', snapshot: this.snapshot() });
  }
  private reportError(message: string) {
    this.state.errors.push(message);
    this.emit({ kind: 'error', message });
  }
  private operation<T>(action: () => Promise<T>): Promise<T> {
    if (this.quitting) return Promise.reject(new Error(message('quitting')));
    const result = this.operations.then(action);
    this.operations = result.catch(() => {});
    return result;
  }
  private project(id: string) {
    const project = this.state.projects.find(p => p.id === id);
    if (!project) throw new Error(message('projectMissing'));
    return project;
  }
  inspectDirectory(path: string): Promise<DirectoryInspection> {
    return inspectDirectory(path, this.state.projects);
  }
  private async editedDirectory(project: Project, path: string): Promise<string> {
    const directory = await this.inspectDirectory(path);
    if (directory.ok) return directory.directory;
    const { problem } = directory;
    if (problem.kind !== 'duplicate') throw new Error(message('projectDirectoryInvalid'));
    if (problem.projectId === project.id) return project.directory;
    throw new Error(message('projectDuplicate', { name: problem.projectName }));
  }
  createProject(draft: ProjectDraft): Promise<ProjectCreation> {
    return this.operation(async () => {
      validateDraft(draft);
      const directory = await this.inspectDirectory(draft.directory);
      if (!directory.ok)
        throw new Error(
          message(directory.problem.kind === 'duplicate' ? 'projectDirectoryExists' : 'projectDirectoryInvalid'),
        );
      const panels = assignedAgents(draft).map(agent => ({ id: randomUUID(), agent }));
      const project = {
        id: randomUUID(),
        name: draft.name.trim(),
        directory: directory.directory,
        panels,
        layout: arrange(
          panels.map(p => p.id),
          this.state.settings.defaultLayout,
        ),
      };
      await this.store.save(project);
      this.state.projects.push(project);
      this.state.activeProjectId = project.id;
      await this.store.saveActiveProject(project.id);
      this.publishSnapshot();
      const launches = await this.panels.startOnFirstOpen(project);
      await this.panels.withdraw(project, launches);
      return { project: structuredClone(project), launches };
    });
  }
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult> {
    return this.operation(async () => {
      const project = this.project(id);
      rejectProjectName(edit.name);
      const next = {
        ...project,
        name: edit.name.trim(),
        directory: await this.editedDirectory(project, edit.directory),
      };
      const changedDirectory = project.directory !== next.directory;
      if (!changedDirectory && project.name === next.name) return { project: structuredClone(project), launches: [] };
      await this.store.save(next);
      Object.assign(project, next);
      this.publishSnapshot();
      const result: ProjectEditResult = { project: structuredClone(project), launches: [] };
      if (changedDirectory && restart) Object.assign(result, await this.panels.restart(project));
      return result;
    });
  }
  async bindRepository(projectId: string, repository: RepositoryReference) {
    this.project(projectId);
    const listed = await this.bindings.findListed(repository);
    return this.operation(async () => {
      this.project(projectId);
      await this.bindings.bind(projectId, listed);
      this.forgeSidebar.forget(projectId);
      this.publishSnapshot();
    });
  }
  unbindRepository(projectId: string) {
    return this.operation(async () => {
      this.project(projectId);
      await this.bindings.unbind(projectId);
      this.forgeSidebar.forget(projectId);
      this.publishSnapshot();
    });
  }
  deleteProject(id: string) {
    return this.operation(async () => {
      const project = this.project(id);
      const failures = await this.panels.stop(project);
      if (failures.length) throw new Error(message('projectDeleteFailed', { reasons: failures.map(nestedMessage) }));
      const index = this.state.projects.indexOf(project);
      const nextActive =
        this.state.activeProjectId === id
          ? (this.state.projects[index + 1]?.id ?? this.state.projects[index - 1]?.id ?? null)
          : this.state.activeProjectId;
      await this.store.deleteProject(id, nextActive);
      this.state.projects = this.state.projects.filter(item => item.id !== id);
      this.panels.forget(project);
      this.bindings.forget(id);
      this.forgeSidebar.forget(id);
      this.dispatches.forget(id);
      const activateNext = this.state.activeProjectId === id;
      this.state.activeProjectId = nextActive;
      this.publishSnapshot();
      if (activateNext && nextActive) await this.panels.startOnFirstOpen(this.project(nextActive));
    });
  }
  async fetchRepositoryChoices(projectId: string, directory: string) {
    this.project(projectId);
    return this.bindings.choices(projectId, directory, found => this.follow(projectId, found));
  }
  async performDirectAction(projectId: string, action: DirectAction) {
    return directAction(this.boundRepository(projectId), action);
  }
  private boundRepository(projectId: string) {
    this.project(projectId);
    return this.bindings.forForgeCall(projectId, found => this.follow(projectId, found));
  }
  private follow(projectId: string, found: RepositoryReference) {
    void this.operation(async () => {
      if (await this.bindings.follow(projectId, found)) this.publishSnapshot();
    }).catch(error => this.reportError(errorMessage(error)));
  }
  dispatch(projectId: string, request: DispatchRequest) {
    return this.operation(async () => {
      const project = this.project(projectId);
      const repository = this.bindings.require(projectId);
      return this.dispatches.dispatch(
        projectId,
        repository,
        request,
        this.state.settings.workflows,
        this.panels.targets(project),
      );
    });
  }
  activateProject(id: string) {
    return this.operation(async () => {
      const project = this.project(id);
      await this.panels.arrangeIfUnlaid(project, this.state.settings.defaultLayout);
      this.state.activeProjectId = id;
      this.publishSnapshot();
      await this.store.saveActiveProject(id);
      await this.panels.startOnFirstOpen(project);
    });
  }
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation> {
    return this.operation(() => this.panels.add(this.project(projectId), agent));
  }
  closePanel(projectId: string, panelId: string) {
    return this.operation(() => this.panels.close(this.project(projectId), panelId));
  }
  placeInLayout(projectId: string, panelId: string, layout: Layout) {
    return this.operation(() => this.panels.place(this.project(projectId), panelId, layout));
  }
  moveToTray(projectId: string, panelId: string) {
    return this.operation(() => this.panels.toTray(this.project(projectId), panelId));
  }
  saveLayout(projectId: string, layout: Layout | null) {
    return this.operation(() => this.panels.saveLayout(this.project(projectId), layout));
  }
  saveSidebar(sidebar: Sidebar, preferences: SidebarPreferences) {
    return this.operation(async () => {
      const { minWidth, invalidMessage } = sidebars[sidebar];
      const parsed = sidebarPreferencesSchema.safeParse(preferences);
      if (!parsed.success) throw new Error(message(invalidMessage));
      const value = { ...parsed.data, width: Math.max(minWidth, parsed.data.width) };
      await this.store.saveSidebar(sidebar, value);
      this.state[sidebar] = value;
      this.publishSnapshot();
    });
  }
  saveSettings(patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const update = structuredClone(patch);
    return this.operation(async () => {
      const result = await this.settingsFile.commit(this.state.settings, update);
      if (result.ok) {
        this.state.settings = structuredClone(result.settings);
        this.state.settingsConflicts = settingsConflicts(result.settings);
        this.publishSnapshot();
      }
      return result;
    }).catch(() => ({ ok: false, kind: 'unavailable', message: message('settingsUnavailable') }));
  }
  quit(): Promise<void> {
    if (this.quitPromise) return this.quitPromise;
    this.quitting = true;
    this.quitPromise = (async () => {
      await this.operations;
      let error: unknown;
      try {
        await this.settingsFile.writeUnchecked(this.state.settings);
      } catch (failure) {
        error = failure;
      }
      try {
        await this.runs.shutdown();
      } catch (failure) {
        error ??= failure;
      }
      try {
        await this.store.close();
      } catch (failure) {
        error ??= failure;
      }
      if (error) throw error;
    })();
    return this.quitPromise;
  }
}
