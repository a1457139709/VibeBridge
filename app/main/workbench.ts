import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { assignedAgents, arrange, validateDraft, removeFromLayout, validateLayout, agentTypes, type AgentType, type DirectoryResult, type Layout, type Panel, type Project, type ProjectDraft, type Settings, type Snapshot, type TerminalEvent, type WorkbenchEvent } from '../shared/model';
import { ProjectStore } from './storage';
import { SettingsFile, defaultSettings } from './settings';
import { TerminalClient } from './terminal-client';

export class Workbench {
  private state: Snapshot = { projects: [], runs: [], activeProjectId: null, settings: defaultSettings(), errors: [] };
  private terminal: TerminalClient;
  private listeners = new Set<(event: WorkbenchEvent) => void>();
  private operations: Promise<unknown> = Promise.resolve();
  private visited = new Set<string>();
  private expectedRuns = new Map<string, string>();
  private quitting = false;
  private quitPromise?: Promise<void>;
  private constructor(private store: ProjectStore, private settingsFile: SettingsFile) {
    this.terminal = new TerminalClient(event => this.terminalEvent(event), message => this.report(message));
  }
  static async open(directory: string) {
    const store = await ProjectStore.open(directory);
    const workbench = new Workbench(store, new SettingsFile(directory));
    try {
      Object.assign(workbench.state, await store.load());
      try { workbench.state.settings = await workbench.settingsFile.read(); }
      catch (error) { workbench.state.errors.push((error as Error).message); }
      return workbench;
    } catch (error) { await workbench.quit(); throw error; }
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
    } else if (event.kind === 'exit') {
      const run = this.state.runs.find(run => run.id === event.runId);
      if (!run || this.expectedRuns.get(run.panelId) !== run.id) return;
      this.state.runs = this.state.runs.filter(r => r.id !== run.id);
      if (!this.quitting) void this.operation(async () => {
        if (this.expectedRuns.get(run.panelId) !== run.id) return;
        await this.removePanel(run.projectId, run.panelId);
      }).catch(error => this.report(error.message));
      this.changed();
    }
    this.emit(event);
  }
  async inspectDirectory(path: string): Promise<DirectoryResult> {
    try {
      const directory = await realpath(path);
      if (!(await stat(directory)).isDirectory()) return { valid: false };
      return { valid: true, directory, name: basename(directory), existingProjectId: this.state.projects.find(p => p.directory === directory)?.id };
    } catch { return { valid: false }; }
  }
  createProject(draft: ProjectDraft) { return this.operation(async () => {
    validateDraft(draft);
    const directory = await this.inspectDirectory(draft.directory);
    if (!directory.valid) throw new Error('项目目录无效');
    if (directory.existingProjectId) throw new Error('该目录已有项目，请打开已有项目');
    const panels = assignedAgents(draft).map(agent => ({ id: randomUUID(), agent }));
    const project = { id: randomUUID(), name: draft.name.trim(), directory: directory.directory!, panels, layout: arrange(panels.map(p => p.id)) };
    await this.store.save(project);
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    await this.store.active(project.id);
    this.changed();
    await this.startProject(project);
    return structuredClone(project);
  }); }
  private async startPanel(project: Project, panel: Panel) {
    const id = randomUUID();
    this.expectedRuns.set(panel.id, id);
    await this.terminal.start({ id, panelId: panel.id, projectId: project.id, directory: project.directory, command: this.state.settings.agents[panel.agent] });
  }
  private async startProject(project: Project) {
    if (this.visited.has(project.id)) return;
    this.visited.add(project.id);
    for (const panel of project.panels) await this.startPanel(project, panel);
  }
  activateProject(id: string) { return this.operation(async () => {
    const project = this.project(id);
    this.state.activeProjectId = id;
    this.changed();
    await this.store.active(id);
    await this.startProject(project);
  }); }
  addPanel(projectId: string, agent: AgentType) { return this.operation(async () => {
    const project = this.project(projectId);
    if (!agentTypes.includes(agent)) throw new Error('Agent 类型无效');
    if (project.panels.length >= 10) throw new Error('每个项目最多 10 个面板');
    const panel = { id: randomUUID(), agent };
    const next = { ...project, panels: [...project.panels, panel], layout: arrange([...project.panels.map(p => p.id), panel.id]) };
    await this.store.save(next);
    Object.assign(project, next); this.changed();
    await this.startPanel(project, panel);
    return panel;
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
  sendInput(runId: string, data: string) { return this.terminal.input(runId, data); }
  resizeRun(runId: string, cols: number, rows: number) { return this.terminal.resize(runId, cols, rows); }
  saveSettings(settings: Settings) { return this.operation(async () => {
    await this.settingsFile.save(settings);
    this.state.settings = structuredClone(settings); this.changed();
  }); }
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
