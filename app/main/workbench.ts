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
  private quitting = false;
  private quitPromise?: Promise<void>;
  private constructor(directory: string, private store: ProjectStore, private settingsFile: SettingsFile) {
    this.terminal = new TerminalClient(directory, event => this.terminalEvent(event), (message, stopped) => {
      if (stopped) {
        for (const run of this.state.runs) if (run.state === 'running') run.state = 'stopped';
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
        this.state.runs = this.state.runs.filter(r => r.id !== run.id);
        if (!this.quitting) void this.operation(async () => {
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
  private async startPanel(project: Project, panel: Panel): Promise<LaunchResult> {
    const id = randomUUID();
    this.expectedRuns.set(panel.id, id);
    const run = await this.terminal.start({ id, panelId: panel.id, projectId: project.id, directory: project.directory, command: this.state.settings.agents[panel.agent] });
    return run.state === 'failed' ? { ok: false, run, error: 'Agent 无法启动' } : { ok: true, run };
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
    const run = this.state.runs.find(r => r.panelId === panelId && r.state === 'running');
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
      try { await this.settingsFile.save(this.state.settings); } catch (failure) { error = failure; }
      try { await this.terminal.shutdown(); } catch (failure) { error ??= failure; }
      try { await this.store.close(); } catch (failure) { error ??= failure; }
      if (error) throw error;
    })();
    return this.quitPromise;
  }
}
