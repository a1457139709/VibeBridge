import { randomUUID } from 'node:crypto';
import { message, detail } from '../shared/messages';
import { arrange, removeFromLayout, parseLayout, layoutStructure, layoutPanelIds, panelPosition, projectPanels, panelLimitReached, agentTypes, type AgentType, type LaunchResult, type Layout, type Panel, type PanelCreation, type PanelView, type Project, type Settings } from '../shared/model';
import type { ProjectStore } from './storage';
import type { RunSupervision } from './run-supervision';
import type { DispatchTargets } from './dispatch';

/** Each project's Agent panels: resident panels and their layout, the tray of ephemeral panels, and which projects
 * have started their panels. Callers find the project and serialize the work; this module only changes its panels. */
export class ProjectPanels {
  private visited = new Set<string>();
  // Each project's tray: its ephemeral panels in the order they joined. Never stored.
  private trays = new Map<string, Panel[]>();
  constructor(private store: Pick<ProjectStore, 'save'>, private supervision: RunSupervision,
    private agents: () => Settings['agents'], private changed: () => void) {}
  /** The project's resident and tray panels as the snapshot shows them. */
  view(project: Project): { panels: PanelView[]; tray: PanelView[] } {
    const view = (panel: Panel) => this.supervision.panelView(panel);
    return { panels: project.panels.map(view), tray: this.tray(project.id).map(view) };
  }
  /** Resident panels, then tray panels. */
  all(project: Project) { return projectPanels({ panels: project.panels, tray: this.tray(project.id) }); }
  private tray(projectId: string) { return this.trays.get(projectId) ?? []; }
  /** Starts the panel's Agent as the Agent settings give its type, with `args` after the configured ones. */
  private startPanel(project: Project, panel: Panel, args: string[] = []) {
    const command = this.agents()[panel.agent];
    return this.supervision.start(project, panel, { ...command, args: [...command.args, ...args] });
  }
  /** Starts the project's resident panels the first time it opens; a visited project starts nothing. */
  async start(project: Project): Promise<LaunchResult[]> {
    if (this.visited.has(project.id)) return [];
    this.visited.add(project.id);
    const launches: LaunchResult[] = [];
    for (const panel of project.panels) launches.push(await this.startPanel(project, panel));
    return launches;
  }
  // Undoes the addition of panels whose Agent never started, for Project Setup. Restored layouts keep
  // their failed panels; this is neither closing a panel nor a run exit.
  async withdraw(project: Project, launches: LaunchResult[]) {
    const panelIds = launches.filter(launch => launch.outcome === 'failed').map(launch => launch.run.panelId);
    if (panelIds.length) await this.removePanels(project, panelIds);
  }
  /** Restarts the resident panels of a visited project whose directory changed; an unvisited project starts nothing. */
  async restart(project: Project): Promise<{ launches: LaunchResult[]; error?: string }> {
    const launches: LaunchResult[] = [];
    if (!this.visited.has(project.id)) return { launches };
    // Tray panels keep running in the directory they started in.
    const failures = await this.supervision.stopPanels(project.panels);
    if (failures.length) return { launches, error: message('projectRestartFailed', { reasons: failures.map(detail) }) };
    for (const panel of project.panels) launches.push(await this.startPanel(project, panel));
    return { launches };
  }
  /** Arranges and saves the resident panels of a project that has panels but no layout. */
  async arrange(project: Project, defaultLayout: Settings['defaultLayout']) {
    if (!project.layout && project.panels.length) {
      project.layout = arrange(project.panels.map(panel => panel.id), defaultLayout);
      await this.store.save(project);
    }
  }
  /** Adds a panel to the end of the project's tray and starts its Agent, with `args` after the configured ones. The layout is unchanged. */
  async add(project: Project, agent: AgentType, args?: string[]): Promise<PanelCreation> {
    if (!agentTypes.includes(agent)) throw new Error(message('agentInvalid'));
    const tray = this.tray(project.id);
    if (panelLimitReached({ panels: project.panels, tray })) throw new Error(message('panelLimit'));
    const panel = { id: randomUUID(), agent };
    this.trays.set(project.id, [...tray, panel]); this.changed();
    const launch = await this.startPanel(project, panel, args);
    if (launch.outcome === 'failed') this.removeFromTray(project.id, panel.id);
    return { panel: structuredClone(panel), launch };
  }
  /** Where a dispatch to the project can go: one of its panels, or a new panel that joins its tray. */
  targets(project: Project): DispatchTargets {
    return {
      panel: id => { const panel = this.all(project).find(panel => panel.id === id); return panel && this.supervision.panelView(panel); },
      add: (agent, args) => this.add(project, agent, args) };
  }
  async close(project: Project, panelId: string) {
    if (!this.all(project).some(p => p.id === panelId)) throw new Error(message('panelMissing'));
    await this.supervision.stopPanel(panelId);
    await this.remove(project, panelId);
  }
  /** Removes a panel from the tray or the layout and releases its run. */
  async remove(project: Project, panelId: string) {
    if (this.tray(project.id).some(panel => panel.id === panelId)) this.removeFromTray(project.id, panelId);
    else await this.removePanels(project, [panelId]);
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
  /**
   * Makes a tray panel resident with the target layout the renderer computed for the drop.
   * The layout places the resident panels plus this one; a swap leaves out the one resident
   * panel whose position this one takes, and that panel joins the end of the tray. Runs are untouched.
   */
  async place(project: Project, panelId: string, layout: Layout) {
    const panel = this.tray(project.id).find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const structure = layoutStructure(layout);
    const placed = layoutPanelIds(structure);
    const replaced = project.panels.filter(resident => !placed.includes(resident.id));
    // A swap is valid only when the placed panel takes the position of the one panel it replaces.
    if (replaced.length > 1 || (replaced.length === 1 && String(panelPosition(structure, panelId)) !== String(panelPosition(project.layout, replaced[0].id)))) throw new Error(message('layoutMismatch'));
    const panels = [...project.panels.filter(resident => !replaced.includes(resident)), panel];
    await this.changeResidency(project, { ...project, panels, layout: parseLayout(structure, panels) },
      [...this.tray(project.id).filter(p => p !== panel), ...replaced]);
  }
  /** Makes a resident panel ephemeral: it joins the end of the tray and the other resident panels fill its space as when it closes. Its run is untouched. */
  async toTray(project: Project, panelId: string) {
    const panel = project.panels.find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    await this.changeResidency(project, { ...project, panels: project.panels.filter(p => p !== panel), layout: removeFromLayout(project.layout, panelId) },
      [...this.tray(project.id), panel]);
  }
  /** Saves which panels are resident, then publishes the project with its new tray. */
  private async changeResidency(project: Project, next: Project, tray: Panel[]) {
    await this.store.save(next);
    Object.assign(project, next);
    this.trays.set(project.id, tray);
    this.changed();
  }
  async saveLayout(project: Project, layout: Layout | null) {
    project.layout = parseLayout(layout, project.panels); this.changed();
    await this.store.save(project);
  }
  /** Stops every panel of a project about to be deleted and returns why any failed to stop. */
  stop(project: Project) { return this.supervision.stopPanels(this.all(project)); }
  /** Once the project's deletion is stored: releases its panels and drops its tray and visit. */
  forget(project: Project) {
    this.supervision.release(this.all(project).map(panel => panel.id));
    this.trays.delete(project.id);
    this.visited.delete(project.id);
  }
}
