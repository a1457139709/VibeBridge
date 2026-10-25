import { message, detail } from '../shared/messages';
import { projectNameError } from '../shared/project-name';
import type { Language, ProjectEdit, ProjectEditResult } from '../shared/model';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { defaultNavigation, navigationWidth, type NavigationPreferences, assignedAgents, arrange, insertIntoLayout, validateDraft, removeFromLayout, validateLayout, agentTypes, type AgentType, type DirectoryResult, launchFailed, type LaunchResult, type Layout, type Panel, type Project, type ProjectCreation, type ProjectDraft, type PanelCreation, type Settings, type Snapshot, type WorkbenchEvent } from '../shared/model';
import { ProjectStore } from './storage';
import { SettingsFile, defaultSettings } from './settings';
import type { SettingsSaveResult } from '../shared/settings';
import { RunSupervision } from './run-supervision';

export class WorkbenchOpenError extends Error {
  constructor(error: unknown, readonly language: Language) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
  }
}

export class Workbench {
  private state: Omit<Snapshot, 'processing' | 'runs'> = { navigation: { ...defaultNavigation }, projects: [], activeProjectId: null, settings: defaultSettings(), settingsMigrationConflict: false, startupTheme: 'system', resolvedTheme: 'light', errors: [] };
  private supervision: RunSupervision;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private visited = new Set<string>();
  private quitting = false;
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
      Object.assign(workbench.state, projects, { settings, errors });
      workbench.state.settingsMigrationConflict = settingsFile.hasMigrationConflict;
      workbench.state.startupTheme = settings.theme;
      workbench.state.resolvedTheme = workbench.state.startupTheme === 'system' ? (systemDark ? 'dark' : 'light') : workbench.state.startupTheme;
      return workbench;
    } catch (error) {
      await store?.close().catch(() => {});
      throw new WorkbenchOpenError(error, settings.language);
    }
  }
  snapshot(): Snapshot { return structuredClone({ ...this.state, runs: this.supervision.runs(), processing: this.supervision.projection(this.state.projects) }); }
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
    await this.withdrawPanels(project, launches.filter(launchFailed).map(launch => launch.run.panelId));
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
      const failures = await this.stopProject(project);
      if (failures.length) result.error = message('projectRestartFailed', { reasons: failures.map(detail) });
      else for (const panel of project.panels) result.launches.push(await this.startPanel(project, panel));
    }
    return result;
  }); }
  deleteProject(id: string) { return this.operation(async () => {
    const project = this.project(id);
    const failures = await this.stopProject(project);
    if (failures.length) throw new Error(message('projectDeleteFailed', { reasons: failures.map(detail) }));
    const index = this.state.projects.indexOf(project);
    const nextActive = this.state.activeProjectId === id
      ? this.state.projects[index + 1]?.id ?? this.state.projects[index - 1]?.id ?? null
      : this.state.activeProjectId;
    // Records and the active-project pointer are removed in the same transaction.
    await this.store.delete(id, nextActive);
    this.state.projects = this.state.projects.filter(item => item.id !== id);
    this.supervision.release(project.panels.map(panel => panel.id));
    this.visited.delete(id);
    const activateNext = this.state.activeProjectId === id;
    this.state.activeProjectId = nextActive;
    this.changed();
    if (activateNext && nextActive) await this.startProject(this.project(nextActive));
  }); }
  private stopProject(project: Project) { return this.supervision.stopProject(project); }
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
  addPanel(projectId: string, agent: AgentType): Promise<PanelCreation> { return this.operation(async () => {
    const project = this.project(projectId);
    if (!agentTypes.includes(agent)) throw new Error(message('agentInvalid'));
    if (project.panels.length >= 10) throw new Error(message('panelLimit'));
    const panel = { id: randomUUID(), agent };
    const next = { ...project, panels: [...project.panels, panel], layout: insertIntoLayout(project.layout, panel.id) };
    await this.store.save(next);
    Object.assign(project, next); this.changed();
    const launch = await this.startPanel(project, panel);
    if (launchFailed(launch)) await this.withdrawPanels(project, [panel.id]);
    return { panel: structuredClone(panel), launch };
  }); }
  // Undoes the addition of panels whose Agent never started. Restored layouts keep
  // their failed panels; this is neither closing a panel nor a run exit.
  private async withdrawPanels(project: Project, panelIds: string[]) {
    if (panelIds.length) await this.removePanels(project, panelIds);
  }
  private removePanel(projectId: string, panelId: string) { return this.removePanels(this.project(projectId), [panelId]); }
  private async removePanels(project: Project, panelIds: string[]) {
    const next = { ...project, panels: project.panels.filter(p => !panelIds.includes(p.id)),
      layout: panelIds.reduce((layout, id) => removeFromLayout(layout, id), project.layout) };
    await this.store.save(next);
    Object.assign(project, next);
    this.supervision.release(panelIds);
    this.changed();
  }
  closePanel(projectId: string, panelId: string) { return this.operation(async () => {
    if (!this.project(projectId).panels.some(p => p.id === panelId)) throw new Error(message('panelMissing'));
    await this.supervision.stopPanel(panelId);
    await this.removePanel(projectId, panelId);
  }); }
  saveLayout(projectId: string, layout: Layout | null) { return this.operation(async () => {
    const project = this.project(projectId);
    validateLayout(layout, project.panels);
    project.layout = structuredClone(layout); this.changed();
    await this.store.save(project);
  }); }
  saveNavigation(preferences: NavigationPreferences) { return this.operation(async () => {
    if (!preferences || typeof preferences.visible !== 'boolean' || !Number.isFinite(preferences.width)) throw new Error(message('navigationInvalid'));
    const navigation = { visible: preferences.visible, width: navigationWidth(preferences.width) };
    await this.store.navigation(navigation);
    this.state.navigation = navigation; this.changed();
  }); }
  sendInput(runId: string, data: string) { return this.supervision.input(runId, data); }
  resizeRun(runId: string, cols: number, rows: number) { return this.supervision.resize(runId, cols, rows); }
  acknowledgeOutput(runId: string, characters: number) { this.supervision.acknowledgeOutput(runId, characters); }
  checkCommand(command: string) { return this.supervision.checkCommand(command); }
  saveSettings(patch: Partial<Settings>): Promise<SettingsSaveResult> {
    const update = structuredClone(patch);
    return this.operation(async () => {
      const result = await this.settingsFile.commit(this.state.settings, update);
      if (result.ok) { this.state.settings = structuredClone(result.settings); this.state.settingsMigrationConflict = false; this.changed(); }
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
