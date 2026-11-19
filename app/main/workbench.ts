import { message, detail } from '../shared/messages';
import { projectNameError } from '../shared/project-name';
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
  type DirectoryResult,
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

export class WorkbenchOpenError extends Error {
  constructor(
    error: unknown,
    readonly language: Language,
  ) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
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
  /** Runs of the projects' panels: their input, size, output flow and the commands that start them. */
  readonly runs: RunSupervision;
  /** The Forge sidebar's lists, its detail, and the repositories its binding pages offer. */
  readonly forgeSidebar: ForgeSidebarData;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private panels: ProjectPanels;
  private bindings: RepositoryBindings;
  private dispatches: Dispatches;
  private quitting = false;
  private quitPromise?: Promise<void>;
  private constructor(
    directory: string,
    private store: ProjectStore,
    private settingsFile: SettingsFile,
    stored: { repositories: Record<string, RepositoryReference>; dispatches: DispatchRecord[] },
  ) {
    this.bindings = new RepositoryBindings(stored.repositories, store);
    this.forgeSidebar = new ForgeSidebarData({
      issuePage: (projectId, query) => issuePage(this.bound(projectId), query),
      pullRequestPage: (projectId, query) => pullRequestPage(this.bound(projectId), query),
      issuesByNumber: (projectId, numbers) => issuesByNumber(this.bound(projectId), numbers),
      pullRequestsByNumber: (projectId, numbers) => pullRequestsByNumber(this.bound(projectId), numbers),
      repositoryChoices: async projectId => this.repositoryChoices(projectId, this.project(projectId).directory),
      issueDetail: (projectId, number) => issueDetail(this.bound(projectId), number),
      pullRequestDetail: (projectId, number) => pullRequestDetail(this.bound(projectId), number),
      forge: projectId => this.bindings.view(projectId).forge,
      emit: event => this.emit(event),
    });
    this.runs = new RunSupervision(directory, {
      changed: () => this.changed(),
      emit: event => this.emit(event),
      report: message => this.report(message),
      onRunExited: run => {
        if (!this.quitting)
          void this.operation(async () => {
            if (!this.runs.expects(run)) return;
            await this.panels.remove(this.project(run.projectId), run.panelId);
          }).catch(error => this.report(error.message));
      },
    });
    this.panels = new ProjectPanels(
      store,
      this.runs,
      () => this.state.settings.agents,
      () => this.changed(),
    );
    this.dispatches = new Dispatches(
      stored.dispatches,
      store,
      this.runs,
      () => this.changed(),
      message => this.report(message),
    );
  }
  static async open(directory: string, systemDark = false) {
    const settingsFile = new SettingsFile(directory);
    let settings = defaultSettings();
    const errors: string[] = [];
    try {
      settings = await settingsFile.read();
    } catch (error) {
      errors.push((error as Error).message);
    }
    let store: ProjectStore | undefined;
    try {
      store = await ProjectStore.open(directory);
      const { repositories, dispatches, ...projects } = await store.load();
      const workbench = new Workbench(directory, store, settingsFile, { repositories, dispatches });
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
    return structuredClone({ ...this.state, projects: this.dispatches.withViews(views) });
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
  private changed() {
    this.emit({ kind: 'snapshot', snapshot: this.snapshot() });
  }
  private report(message: string) {
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
  inspectDirectory(path: string): Promise<DirectoryResult> {
    return inspectDirectory(path, this.state.projects);
  }
  createProject(draft: ProjectDraft): Promise<ProjectCreation> {
    return this.operation(async () => {
      validateDraft(draft);
      const directory = await this.inspectDirectory(draft.directory);
      if (!directory.valid) throw new Error(message('projectDirectoryInvalid'));
      if (directory.existingProjectId) throw new Error(message('projectDirectoryExists'));
      const panels = assignedAgents(draft).map(agent => ({ id: randomUUID(), agent }));
      const project = {
        id: randomUUID(),
        name: draft.name.trim(),
        directory: directory.directory!,
        panels,
        layout: arrange(
          panels.map(p => p.id),
          this.state.settings.defaultLayout,
        ),
      };
      await this.store.save(project);
      this.state.projects.push(project);
      this.state.activeProjectId = project.id;
      await this.store.active(project.id);
      this.changed();
      const launches = await this.panels.start(project);
      await this.panels.withdraw(project, launches);
      return { project: structuredClone(project), launches };
    });
  }
  /** Saves name and directory; the Repository Binding stays as it is. */
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult> {
    return this.operation(async () => {
      const project = this.project(id);
      const nameError = projectNameError(edit.name);
      if (nameError) throw new Error(nameError);
      const directory = await this.inspectDirectory(edit.directory);
      if (!directory.valid) throw new Error(message('projectDirectoryInvalid'));
      if (directory.existingProjectId && directory.existingProjectId !== id)
        throw new Error(message('projectDuplicate', { name: directory.existingProjectName! }));
      const next = { ...project, name: edit.name.trim(), directory: directory.directory! };
      const changedDirectory = project.directory !== next.directory;
      if (!changedDirectory && project.name === next.name) return { project: structuredClone(project), launches: [] };
      await this.store.save(next);
      Object.assign(project, next);
      this.changed();
      const result: ProjectEditResult = { project: structuredClone(project), launches: [] };
      if (changedDirectory && restart) Object.assign(result, await this.panels.restart(project));
      return result;
    });
  }
  /** Binds or rebinds the project to `repository`. The forge's list is read again first, outside the operation queue
   * since it waits on the forge CLI; when it cannot be read or does not show the repository, nothing is written. */
  async bindRepository(projectId: string, repository: RepositoryReference) {
    this.project(projectId);
    const listed = await this.bindings.findListed(repository);
    return this.operation(async () => {
      this.project(projectId);
      await this.bindings.bind(projectId, listed);
      this.forgeSidebar.forget(projectId);
      this.changed();
    });
  }
  /** Unbinds the project. It reads no list, so it works without the forge CLI. */
  unbindRepository(projectId: string) {
    return this.operation(async () => {
      this.project(projectId);
      await this.bindings.unbind(projectId);
      this.forgeSidebar.forget(projectId);
      this.changed();
    });
  }
  deleteProject(id: string) {
    return this.operation(async () => {
      const project = this.project(id);
      const failures = await this.panels.stop(project);
      if (failures.length) throw new Error(message('projectDeleteFailed', { reasons: failures.map(detail) }));
      const index = this.state.projects.indexOf(project);
      const nextActive =
        this.state.activeProjectId === id
          ? (this.state.projects[index + 1]?.id ?? this.state.projects[index - 1]?.id ?? null)
          : this.state.activeProjectId;
      // Records and the active-project pointer are removed in the same transaction.
      await this.store.delete(id, nextActive);
      this.state.projects = this.state.projects.filter(item => item.id !== id);
      this.panels.forget(project);
      this.bindings.forget(id);
      this.forgeSidebar.forget(id);
      this.dispatches.forget(id);
      const activateNext = this.state.activeProjectId === id;
      this.state.activeProjectId = nextActive;
      this.changed();
      if (activateNext && nextActive) await this.panels.start(this.project(nextActive));
    });
  }
  // The repositories a project can bind, and direct actions on its bound repository; DesktopAPI documents each.
  async repositoryChoices(projectId: string, directory: string) {
    this.project(projectId);
    return this.bindings.choices(projectId, directory, found => this.follow(projectId, found));
  }
  async directAction(projectId: string, action: DirectAction) {
    return directAction(this.bound(projectId), action);
  }
  /** The project's bound repository for a forge call; where the forge finds it at another path, the binding follows. */
  private bound(projectId: string) {
    this.project(projectId);
    return this.bindings.forCall(projectId, found => this.follow(projectId, found));
  }
  /** Writes a binding at the path its repository was found at, in the operation queue, unless the project was rebound,
   * unbound or deleted meanwhile. */
  private follow(projectId: string, found: RepositoryReference) {
    void this.operation(async () => {
      if (await this.bindings.follow(projectId, found)) this.changed();
    }).catch(error => this.report((error as Error).message));
  }
  /** Dispatches an issue of the project's bound repository with a command of an enabled workflow to one of its panels
   * that has a run, or to a new panel that joins its tray, and records the dispatch on the session that takes it. */
  dispatch(projectId: string, request: DispatchRequest) {
    return this.operation(async () => {
      const project = this.project(projectId);
      const repository = this.bindings.bound(projectId);
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
      await this.panels.arrange(project, this.state.settings.defaultLayout);
      this.state.activeProjectId = id;
      this.changed();
      await this.store.active(id);
      await this.panels.start(project);
    });
  }
  /** Adds a panel to the end of the project's tray and starts its Agent. The layout is unchanged. */
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
  /** Saves a sidebar's preferences with its width at least the sidebar's narrowest. */
  saveSidebar(sidebar: Sidebar, preferences: SidebarPreferences) {
    return this.operation(async () => {
      const { minWidth, invalid } = sidebars[sidebar];
      const parsed = sidebarPreferencesSchema.safeParse(preferences);
      if (!parsed.success) throw new Error(message(invalid));
      const value = { ...parsed.data, width: Math.max(minWidth, parsed.data.width) };
      await this.store.sidebar(sidebar, value);
      this.state[sidebar] = value;
      this.changed();
    });
  }
  saveSettings(patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const update = structuredClone(patch);
    return this.operation(async () => {
      const result = await this.settingsFile.commit(this.state.settings, update);
      if (result.ok) {
        this.state.settings = structuredClone(result.settings);
        this.state.settingsConflicts = settingsConflicts(result.settings);
        this.changed();
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
        await this.settingsFile.saveOnQuit(this.state.settings);
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
