import { message, detail } from '../shared/messages';
import { projectNameError } from '../shared/project-name';
import type { Language, ProjectEdit, ProjectEditResult } from '../shared/model';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { defaultIssueSidebar, defaultNavigation, issueSidebarSchema, issueSidebarWidth, navigationSchema, navigationWidth, type IssueSidebarPreferences, type NavigationPreferences, assignedAgents, arrange, validateDraft, removeFromLayout, parseLayout, layoutStructure, layoutPanelIds, panelPosition, projectPanels, panelLimitReached, agentTypes, type AgentType, type DirectoryResult, type LaunchResult, type Layout, type Panel, type Project, type ProjectCreation, type ProjectDraft, type PanelCreation, type Settings, type Snapshot, type WorkbenchEvent } from '../shared/model';
import { ProjectStore } from './storage';
import { SettingsFile, defaultSettings } from './settings';
import { settingsConflicts, type SettingsSaveResult } from '../shared/settings';
import { RunSupervision } from './run-supervision';
import { commandEnvironment } from '../terminal/environment';
import type { IssueDetailResult, IssueFilter, IssuePageResult, MergeRequestPageResult, RepositoryChoices, RepositoryReference } from '../shared/code-hosting';
import type { CommandEnvironment } from './code-hosting/platform';
import { bindableRepository, repositoryChoices } from './code-hosting/binding';
import { issueDetail, issuePage, mergeRequestPage } from './code-hosting/issues';

export class WorkbenchOpenError extends Error {
  constructor(error: unknown, readonly language: Language) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export class Workbench {
  private state: Omit<Snapshot, 'projects'> & { projects: Project[] } = { navigation: { ...defaultNavigation }, issueSidebar: { ...defaultIssueSidebar }, projects: [], activeProjectId: null, settings: defaultSettings(), settingsConflicts: [], startupTheme: 'system', resolvedTheme: 'light', errors: [] };
  private supervision: RunSupervision;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private visited = new Set<string>();
  // Each project's tray: its ephemeral panels in the order they joined. Never stored.
  private trays = new Map<string, Panel[]>();
  private quitting = false;
  // Platform CLIs and git run in the login-shell environment Agent Runs get, read once per Workbench.
  private environment?: Promise<CommandEnvironment>;
  private quitPromise?: Promise<void>;
  private constructor(directory: string, private store: ProjectStore, private settingsFile: SettingsFile) {
    this.supervision = new RunSupervision(directory, { changed: () => this.changed(), emit: event => this.emit(event), report: message => this.report(message),
      onRunExited: run => {
        if (!this.quitting) void this.operation(async () => {
          if (!this.supervision.expects(run)) return;
          await this.removePanel(run.projectId, run.panelId);
        }).catch(error => this.report(error.message));
      } });
  }
  static async open(directory: string, systemDark = false) {
    const settingsFile = new SettingsFile(directory);
    let settings = defaultSettings();
    const errors: string[] = [];
    try { settings = await settingsFile.read(); }
    catch (error) { errors.push((error as Error).message); }
    let store: ProjectStore | undefined;
    try {
      store = await ProjectStore.open(directory);
      const projects = await store.load();
      const workbench = new Workbench(directory, store, settingsFile);
      Object.assign(workbench.state, projects, { settings, settingsConflicts: settingsConflicts(settings), errors });
      workbench.state.startupTheme = settings.theme;
      workbench.state.resolvedTheme = workbench.state.startupTheme === 'system' ? (systemDark ? 'dark' : 'light') : workbench.state.startupTheme;
      return workbench;
    } catch (error) {
      await store?.close().catch(() => {});
      throw new WorkbenchOpenError(error, settings.language);
    }
  }
  snapshot(): Snapshot {
    const view = (panel: Panel) => this.supervision.panelView(panel);
    const projects = this.state.projects.map(project => ({ ...project, panels: project.panels.map(view), tray: this.tray(project.id).map(view) }));
    return structuredClone({ ...this.state, projects });
  }
  subscribe(listener: (event: WorkbenchEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: WorkbenchEvent) { for (const listener of this.listeners) listener(event); }
  private changed() { this.emit({ kind: 'snapshot', snapshot: this.snapshot() }); }
  private report(message: string) { this.state.errors.push(message); this.emit({ kind: 'error', message }); }
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
  private tray(projectId: string) { return this.trays.get(projectId) ?? []; }
  private panels(project: Project) { return projectPanels({ panels: project.panels, tray: this.tray(project.id) }); }
  async inspectDirectory(path: string): Promise<DirectoryResult> {
    try {
      const directory = await realpath(path);
      if (!(await stat(directory)).isDirectory()) return { valid: false };
      const existing = this.state.projects.find(project => project.directory === directory);
      return { valid: true, directory, name: basename(directory), existingProjectId: existing?.id, existingProjectName: existing?.name };
    } catch { return { valid: false }; }
  }
  createProject(draft: ProjectDraft): Promise<ProjectCreation> { return this.operation(async () => {
    validateDraft(draft);
    const directory = await this.inspectDirectory(draft.directory);
    if (!directory.valid) throw new Error(message('projectDirectoryInvalid'));
    if (directory.existingProjectId) throw new Error(message('projectDirectoryExists'));
    const panels = assignedAgents(draft).map(agent => ({ id: randomUUID(), agent }));
    const project = { id: randomUUID(), name: draft.name.trim(), directory: directory.directory!, panels, layout: arrange(panels.map(p => p.id), this.state.settings.defaultLayout) };
    await this.store.save(project);
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    await this.store.active(project.id);
    this.changed();
    const launches = await this.startProject(project);
    await this.withdrawPanels(project, launches.filter(launch => launch.outcome === 'failed').map(launch => launch.run.panelId));
    return { project: structuredClone(project), launches };
  }); }
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult> { return this.operation(async () => {
    const project = this.project(id);
    const nameError = projectNameError(edit.name);
    if (nameError) throw new Error(nameError);
    const directory = await this.inspectDirectory(edit.directory);
    if (!directory.valid) throw new Error(message('projectDirectoryInvalid'));
    if (directory.existingProjectId && directory.existingProjectId !== id) throw new Error(message('projectDuplicate', { name: directory.existingProjectName! }));
    const next = { ...project, name: edit.name.trim(), directory: directory.directory! };
    const changedDirectory = project.directory !== next.directory;
    if (!changedDirectory && project.name === next.name) return { project: structuredClone(project), launches: [] };
    await this.store.save(next);
    Object.assign(project, next); this.changed();
    const result: ProjectEditResult = { project: structuredClone(project), launches: [] };
    if (changedDirectory && restart && this.visited.has(id)) {
      // Tray panels keep running in the directory they started in.
      const failures = await this.supervision.stopPanels(project.panels);
      if (failures.length) result.error = message('projectRestartFailed', { reasons: failures.map(detail) });
      else for (const panel of project.panels) result.launches.push(await this.startPanel(project, panel));
    }
    return result;
  }); }
  deleteProject(id: string) { return this.operation(async () => {
    const project = this.project(id);
    const panels = this.panels(project);
    const failures = await this.supervision.stopPanels(panels);
    if (failures.length) throw new Error(message('projectDeleteFailed', { reasons: failures.map(detail) }));
    const index = this.state.projects.indexOf(project);
    const nextActive = this.state.activeProjectId === id
      ? this.state.projects[index + 1]?.id ?? this.state.projects[index - 1]?.id ?? null
      : this.state.activeProjectId;
    // Records and the active-project pointer are removed in the same transaction.
    await this.store.delete(id, nextActive);
    this.state.projects = this.state.projects.filter(item => item.id !== id);
    this.supervision.release(panels.map(panel => panel.id));
    this.trays.delete(id);
    this.visited.delete(id);
    const activateNext = this.state.activeProjectId === id;
    this.state.activeProjectId = nextActive;
    this.changed();
    if (activateNext && nextActive) await this.startProject(this.project(nextActive));
  }); }
  private startPanel(project: Project, panel: Panel) { return this.supervision.start(project, panel, this.state.settings.agents[panel.agent]); }
  private async startProject(project: Project): Promise<LaunchResult[]> {
    if (this.visited.has(project.id)) return [];
    this.visited.add(project.id);
    const launches: LaunchResult[] = [];
    for (const panel of project.panels) launches.push(await this.startPanel(project, panel));
    return launches;
  }
  activateProject(id: string) { return this.operation(async () => {
    const project = this.project(id);
    if (!project.layout && project.panels.length) {
      project.layout = arrange(project.panels.map(panel => panel.id), this.state.settings.defaultLayout);
      await this.store.save(project);
    }
    this.state.activeProjectId = id;
    this.changed();
    await this.store.active(id);
    await this.startProject(project);
  }); }
  /** Adds a panel to the end of the project's tray and starts its Agent. The layout is unchanged. */
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation> { return this.operation(async () => {
    const project = this.project(projectId);
    if (!agentTypes.includes(agent)) throw new Error(message('agentInvalid'));
    const tray = this.tray(projectId);
    if (panelLimitReached({ panels: project.panels, tray })) throw new Error(message('panelLimit'));
    const panel = { id: randomUUID(), agent };
    this.trays.set(projectId, [...tray, panel]); this.changed();
    const launch = await this.startPanel(project, panel);
    if (launch.outcome === 'failed') this.removeFromTray(projectId, panel.id);
    return { panel: structuredClone(panel), launch };
  }); }
  // Undoes the addition of panels whose Agent never started. Restored layouts keep
  // their failed panels; this is neither closing a panel nor a run exit.
  private async withdrawPanels(project: Project, panelIds: string[]) {
    if (panelIds.length) await this.removePanels(project, panelIds);
  }
  private async removePanel(projectId: string, panelId: string) {
    if (this.tray(projectId).some(panel => panel.id === panelId)) this.removeFromTray(projectId, panelId);
    else await this.removePanels(this.project(projectId), [panelId]);
  }
  private removeFromTray(projectId: string, panelId: string) {
    this.trays.set(projectId, this.tray(projectId).filter(panel => panel.id !== panelId));
    this.supervision.release([panelId]);
    this.changed();
  }
  private async removePanels(project: Project, panelIds: string[]) {
    const next = { ...project, panels: project.panels.filter(p => !panelIds.includes(p.id)),
      layout: panelIds.reduce((layout, id) => removeFromLayout(layout, id), project.layout) };
    await this.store.save(next);
    Object.assign(project, next);
    this.supervision.release(panelIds);
    this.changed();
  }
  closePanel(projectId: string, panelId: string) { return this.operation(async () => {
    if (!this.panels(this.project(projectId)).some(p => p.id === panelId)) throw new Error(message('panelMissing'));
    await this.supervision.stopPanel(panelId);
    await this.removePanel(projectId, panelId);
  }); }
  /**
   * Makes a tray panel resident with the target layout the renderer computed for the drop.
   * The layout places the resident panels plus this one; a swap leaves out the one resident
   * panel whose position this one takes, and that panel joins the end of the tray. Runs are untouched.
   */
  placeInLayout(projectId: string, panelId: string, layout: Layout) { return this.operation(async () => {
    const project = this.project(projectId);
    const panel = this.tray(projectId).find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const structure = layoutStructure(layout);
    const placed = layoutPanelIds(structure);
    const replaced = project.panels.filter(resident => !placed.includes(resident.id));
    // A swap is valid only when the placed panel takes the position of the one panel it replaces.
    if (replaced.length > 1 || (replaced.length === 1 && String(panelPosition(structure, panelId)) !== String(panelPosition(project.layout, replaced[0].id)))) throw new Error(message('layoutMismatch'));
    const panels = [...project.panels.filter(resident => !replaced.includes(resident)), panel];
    await this.changeResidency(project, { ...project, panels, layout: parseLayout(structure, panels) },
      [...this.tray(projectId).filter(p => p !== panel), ...replaced]);
  }); }
  /** Makes a resident panel ephemeral: it joins the end of the tray and the other resident panels fill its space as when it closes. Its run is untouched. */
  moveToTray(projectId: string, panelId: string) { return this.operation(async () => {
    const project = this.project(projectId);
    const panel = project.panels.find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    await this.changeResidency(project, { ...project, panels: project.panels.filter(p => p !== panel), layout: removeFromLayout(project.layout, panelId) },
      [...this.tray(projectId), panel]);
  }); }
  /** Saves which panels are resident, then publishes the project with its new tray. */
  private async changeResidency(project: Project, next: Project, tray: Panel[]) {
    await this.store.save(next);
    Object.assign(project, next);
    this.trays.set(project.id, tray);
    this.changed();
  }
  saveLayout(projectId: string, layout: Layout | null) { return this.operation(async () => {
    const project = this.project(projectId);
    project.layout = parseLayout(layout, project.panels); this.changed();
    await this.store.save(project);
  }); }
  saveNavigation(preferences: NavigationPreferences) { return this.operation(async () => {
    const parsed = navigationSchema.safeParse(preferences);
    if (!parsed.success) throw new Error(message('navigationInvalid'));
    const navigation = { ...parsed.data, width: navigationWidth(parsed.data.width) };
    await this.store.navigation(navigation);
    this.state.navigation = navigation; this.changed();
  }); }
  saveIssueSidebar(preferences: IssueSidebarPreferences) { return this.operation(async () => {
    const parsed = issueSidebarSchema.safeParse(preferences);
    if (!parsed.success) throw new Error(message('issueSidebarInvalid'));
    const issueSidebar = { ...parsed.data, width: issueSidebarWidth(parsed.data.width) };
    await this.store.issueSidebar(issueSidebar);
    this.state.issueSidebar = issueSidebar; this.changed();
  }); }
  private commandEnvironment() { return this.environment ??= commandEnvironment().catch(error => { this.environment = undefined; throw error; }); }
  /** The repositories the platform CLI's signed-in account may bind to the project, with the one its directory's `origin` points to. */
  async repositoryChoices(projectId: string): Promise<RepositoryChoices> {
    const project = this.project(projectId);
    return repositoryChoices(project, await this.commandEnvironment());
  }
  /** Binds one of the project's repository choices, or with null removes its binding. A project has at most one binding. */
  async bindRepository(projectId: string, repository: RepositoryReference | null): Promise<void> {
    this.project(projectId);
    if (repository) repository = await bindableRepository(repository, () => this.commandEnvironment());
    const binding = repository;
    return this.operation(async () => {
      const project = this.project(projectId);
      await this.store.bind(projectId, binding);
      if (binding) project.repository = binding; else delete project.repository;
      this.changed();
    });
  }
  /** One page of the issues of the project's bound repository, filtered by its platform; null reads the first page. */
  async issuePage(projectId: string, filter: IssueFilter, cursor: string | null): Promise<IssuePageResult> {
    return issuePage(this.project(projectId).repository, filter, cursor, await this.commandEnvironment());
  }
  /** One page of the merge requests of the project's bound repository, filtered by its platform; null reads the first page. */
  async mergeRequestPage(projectId: string, filter: IssueFilter, cursor: string | null): Promise<MergeRequestPageResult> {
    return mergeRequestPage(this.project(projectId).repository, filter, cursor, await this.commandEnvironment());
  }
  /** The bound repository's issue with that number, with its comments and relations, read from its platform. */
  async issueDetail(projectId: string, number: number): Promise<IssueDetailResult> {
    return issueDetail(this.project(projectId).repository, number, await this.commandEnvironment());
  }
  sendInput(runId: string, data: string) { return this.supervision.input(runId, data); }
  resizeRun(runId: string, cols: number, rows: number) { return this.supervision.resize(runId, cols, rows); }
  acknowledgeOutput(runId: string, characters: number) { this.supervision.acknowledgeOutput(runId, characters); }
  checkCommand(command: string) { return this.supervision.checkCommand(command); }
  saveSettings(patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const update = structuredClone(patch);
    return this.operation(async () => {
      const result = await this.settingsFile.commit(this.state.settings, update);
      if (result.ok) { this.state.settings = structuredClone(result.settings); this.state.settingsConflicts = settingsConflicts(result.settings); this.changed(); }
      return result;
    }).catch(() => ({ ok: false, kind: 'unavailable', message: message('settingsUnavailable') }));
  }
  quit(): Promise<void> {
    if (this.quitPromise) return this.quitPromise;
    this.quitting = true;
    this.quitPromise = (async () => {
      await this.operations;
      let error: unknown;
      try { await this.settingsFile.saveOnQuit(this.state.settings); } catch (failure) { error = failure; }
      try { await this.supervision.shutdown(); } catch (failure) { error ??= failure; }
      try { await this.store.close(); } catch (failure) { error ??= failure; }
      if (error) throw error;
    })();
    return this.quitPromise;
  }
}
