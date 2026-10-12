import { projectNameError } from '../shared/project-name';
import type { ProjectEdit, ProjectEditResult } from '../shared/model';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { defaultNavigation, navigationWidth, type NavigationPreferences, assignedAgents, arrange, insertIntoLayout, validateDraft, removeFromLayout, validateLayout, agentTypes, type AgentType, type DirectoryResult, type LaunchResult, type Layout, type Panel, type Project, type ProjectCreation, type ProjectDraft, type PanelCreation, type Settings, type Snapshot, type TerminalEvent, type WorkbenchEvent } from '../shared/model';
import { ProjectStore } from './storage';
import { SettingsFile, defaultSettings } from './settings';
import { TerminalClient } from './terminal-client';

export class Workbench {
  private state: Snapshot = { navigation: { ...defaultNavigation }, projects: [], runs: [], activeProjectId: null, settings: defaultSettings(), startupTheme: 'system', resolvedTheme: 'light', errors: [] };
  private terminal: TerminalClient;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private visited = new Set<string>();
  private expectedRuns = new Map<string, string>();
  private terminalFailure?: string;
  private controlledStops = new Set<string>();
  private quitting = false;
  private quitPromise?: Promise<void>;
  private constructor(directory: string, private store: ProjectStore, private settingsFile: SettingsFile) {
    this.terminal = new TerminalClient(directory, event => this.terminalEvent(event), (message, stopped) => {
      if (stopped) {
        this.terminalFailure = message;
        for (const run of this.state.runs) if (run.state === 'running' || run.state === 'starting') run.state = 'stopped';
        this.changed();
      }
      this.report(message);
    });
  }
  static async open(directory: string, systemDark = false) {
    const store = await ProjectStore.open(directory);
    const workbench = new Workbench(directory, store, new SettingsFile(directory));
    try {
      Object.assign(workbench.state, await store.load());
      try { workbench.state.settings = await workbench.settingsFile.read(); }
      catch (error) { workbench.state.errors.push((error as Error).message); }
      workbench.state.startupTheme = workbench.state.settings.theme;
      workbench.state.resolvedTheme = workbench.state.startupTheme === 'system' ? (systemDark ? 'dark' : 'light') : workbench.state.startupTheme;
      return workbench;
    } catch (error) {
      workbench.quitting = true;
      await Promise.allSettled([workbench.terminal.shutdown(), store.close()]);
      throw error;
    }
  }
  snapshot(): Snapshot { return structuredClone(this.state); }
  subscribe(listener: (event: WorkbenchEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(event: WorkbenchEvent) { for (const listener of this.listeners) listener(event); }
  private changed() { this.emit({ kind: 'snapshot', snapshot: this.snapshot() }); }
  private report(message: string) { this.state.errors.push(message); this.emit({ kind: 'error', message }); }
  private operation<T>(action: () => Promise<T>): Promise<T> {
    if (this.quitting) return Promise.reject(new Error('工作台正在退出'));
    const result = this.operations.then(action);
    this.operations = result.catch(() => {});
    return result;
  }
  private project(id: string) {
    const project = this.state.projects.find(p => p.id === id);
    if (!project) throw new Error('项目不存在');
    return project;
  }
  private terminalEvent(event: TerminalEvent) {
    if (event.kind === 'started') {
      if (this.expectedRuns.get(event.run.panelId) !== event.run.id) return;
      this.state.runs = this.state.runs.filter(run => run.panelId !== event.run.panelId).concat(event.run);
      this.changed();
    } else {
      const run = this.state.runs.find(run => run.id === event.runId);
      if (!run || run.state !== 'running' || this.expectedRuns.get(run.panelId) !== run.id) return;
      if (event.kind === 'exit') {
        const controlled = this.controlledStops.delete(run.id);
        if (controlled) run.state = 'stopped';
        else this.state.runs = this.state.runs.filter(r => r.id !== run.id);
        if (!this.quitting && !controlled) void this.operation(async () => {
          if (this.expectedRuns.get(run.panelId) !== run.id) return;
          await this.removePanel(run.projectId, run.panelId);
        }).catch(error => this.report(error.message));
        this.changed();
      }
    }
    this.emit(event);
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
    if (!directory.valid) throw new Error('项目目录无效');
    if (directory.existingProjectId) throw new Error('该目录已有项目，请打开已有项目');
    const panels = assignedAgents(draft).map(agent => ({ id: randomUUID(), agent }));
    const project = { id: randomUUID(), name: draft.name.trim(), directory: directory.directory!, panels, layout: arrange(panels.map(p => p.id), this.state.settings.defaultLayout) };
    await this.store.save(project);
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    await this.store.active(project.id);
    this.changed();
    const launches = await this.startProject(project);
    return { project: structuredClone(project), launches };
  }); }
  editProject(id: string, edit: ProjectEdit, restart: boolean): Promise<ProjectEditResult> { return this.operation(async () => {
    const project = this.project(id);
    const nameError = projectNameError(edit.name);
    if (nameError) throw new Error(nameError);
    const directory = await this.inspectDirectory(edit.directory);
    if (!directory.valid) throw new Error('项目目录无效');
    if (directory.existingProjectId && directory.existingProjectId !== id) throw new Error(`此目录已添加为项目『${directory.existingProjectName}』，请打开已有项目`);
    const next = { ...project, name: edit.name.trim(), directory: directory.directory! };
    const changedDirectory = project.directory !== next.directory;
    if (!changedDirectory && project.name === next.name) return { project: structuredClone(project), launches: [] };
    await this.store.save(next);
    Object.assign(project, next); this.changed();
    const result: ProjectEditResult = { project: structuredClone(project), launches: [] };
    if (changedDirectory && restart && this.visited.has(id)) {
      const failures = await this.stopProject(project);
      if (failures.length) result.error = `项目已保存，但停止失败，未重新启动：${failures.join('；')}`;
      else for (const panel of project.panels) result.launches.push(await this.startPanel(project, panel));
    }
    return result;
  }); }
  deleteProject(id: string) { return this.operation(async () => {
    const project = this.project(id);
    const failures = await this.stopProject(project);
    if (failures.length) throw new Error(`项目未删除，停止失败：${failures.join('；')}`);
    const index = this.state.projects.indexOf(project);
    const nextActive = this.state.activeProjectId === id
      ? this.state.projects[index + 1]?.id ?? this.state.projects[index - 1]?.id ?? null
      : this.state.activeProjectId;
    // Records and the active-project pointer are removed in the same transaction.
    await this.store.delete(id, nextActive);
    this.state.projects = this.state.projects.filter(item => item.id !== id);
    this.state.runs = this.state.runs.filter(run => run.projectId !== id);
    for (const panel of project.panels) this.expectedRuns.delete(panel.id);
    this.visited.delete(id);
    const activateNext = this.state.activeProjectId === id;
    this.state.activeProjectId = nextActive;
    this.changed();
    if (activateNext && nextActive) await this.startProject(this.project(nextActive));
  }); }
  private async stopProject(project: Project): Promise<string[]> {
    if (this.terminalFailure && this.state.runs.some(run => run.projectId === project.id)) return [this.terminalFailure];
    const failures: string[] = [];
    for (const run of this.state.runs.filter(run => run.projectId === project.id && (run.state === 'running' || run.state === 'starting'))) {
      // Mark before requesting cleanup: its exit event can arrive before the response.
      this.controlledStops.add(run.id);
      try { await this.terminal.stop(run.id); }
      catch (error) { failures.push(`面板 ${project.panels.findIndex(panel => panel.id === run.panelId) + 1}：${(error as Error).message}`); }
    }
    return failures;
  }
  private async startPanel(project: Project, panel: Panel): Promise<LaunchResult> {
    const id = randomUUID();
    this.expectedRuns.set(panel.id, id);
    try {
      const run = await this.terminal.start({ id, panelId: panel.id, projectId: project.id, directory: project.directory, command: this.state.settings.agents[panel.agent] });
      return run.state === 'failed' ? { ok: false, run, error: 'Agent 无法启动' } : { ok: true, run };
    } catch (error) {
      // A missing response is not proof that the process never started. Preserve any
      // observed run and keep accepting its later events instead of retrying implicitly.
      const observed = this.state.runs.find(run => run.id === id);
      const run = observed ?? { id, panelId: panel.id, projectId: project.id, state: 'starting' as const };
      if (!observed) this.terminalEvent({ kind: 'started', run });
      return { ok: false, run: structuredClone(run), error: `启动结果未确认：${(error as Error).message}` };
    }
  }
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
    if (!agentTypes.includes(agent)) throw new Error('Agent 类型无效');
    if (project.panels.length >= 10) throw new Error('每个项目最多 10 个面板');
    const panel = { id: randomUUID(), agent };
    const next = { ...project, panels: [...project.panels, panel], layout: insertIntoLayout(project.layout, panel.id) };
    await this.store.save(next);
    Object.assign(project, next); this.changed();
    const launch = await this.startPanel(project, panel);
    return { panel: structuredClone(panel), launch };
  }); }
  private async removePanel(projectId: string, panelId: string) {
    const project = this.project(projectId);
    const next = { ...project, panels: project.panels.filter(p => p.id !== panelId), layout: removeFromLayout(project.layout, panelId) };
    await this.store.save(next);
    Object.assign(project, next);
    this.expectedRuns.delete(panelId);
    this.state.runs = this.state.runs.filter(r => r.panelId !== panelId);
    this.changed();
  }
  closePanel(projectId: string, panelId: string) { return this.operation(async () => {
    if (!this.project(projectId).panels.some(p => p.id === panelId)) throw new Error('面板不存在');
    const run = this.state.runs.find(r => r.panelId === panelId && (r.state === 'running' || r.state === 'starting'));
    if (run) await this.terminal.stop(run.id);
    await this.removePanel(projectId, panelId);
  }); }
  saveLayout(projectId: string, layout: Layout | null) { return this.operation(async () => {
    const project = this.project(projectId);
    validateLayout(layout, project.panels);
    project.layout = structuredClone(layout); this.changed();
    await this.store.save(project);
  }); }
  saveNavigation(preferences: NavigationPreferences) { return this.operation(async () => {
    if (!preferences || typeof preferences.visible !== 'boolean' || !Number.isFinite(preferences.width)) throw new Error('导航偏好无效');
    const navigation = { visible: preferences.visible, width: navigationWidth(preferences.width) };
    await this.store.navigation(navigation);
    this.state.navigation = navigation; this.changed();
  }); }
  sendInput(runId: string, data: string) { return this.terminal.input(runId, data); }
  resizeRun(runId: string, cols: number, rows: number) { return this.terminal.resize(runId, cols, rows); }
  acknowledgeOutput(runId: string, characters: number) { this.terminal.acknowledgeOutput(runId, characters); }
  checkCommand(command: string) { return this.terminal.checkCommand(command); }
  saveSettings(patch: Partial<Settings>) {
    const update = structuredClone(patch);
    return this.operation(async () => {
      const settings = { ...this.state.settings, ...update };
      await this.settingsFile.save(settings);
      this.state.settings = structuredClone(settings); this.changed();
    });
  }
  quit(): Promise<void> {
    if (this.quitPromise) return this.quitPromise;
    this.quitting = true;
    this.quitPromise = (async () => {
      await this.operations;
      let error: unknown;
      try { await this.settingsFile.saveOnQuit(this.state.settings); } catch (failure) { error = failure; }
      try { await this.terminal.shutdown(); } catch (failure) { error ??= failure; }
      try { await this.store.close(); } catch (failure) { error ??= failure; }
      if (error) throw error;
    })();
    return this.quitPromise;
  }
}
