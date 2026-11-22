import { randomUUID } from 'node:crypto';
import { message, nestedMessage } from '../../shared/messages';
import {
  arrange,
  removeFromLayout,
  parseLayout,
  parseLayoutStructure,
  layoutPanelIds,
  panelPath,
  projectPanels,
  panelLimitReached,
  agentTypes,
  type AgentType,
  type LaunchResult,
  type Layout,
  type Panel,
  type PanelCreation,
  type PanelView,
  type Project,
  type Settings,
} from '../../shared/model';
import type { ProjectStore } from '../persistence/storage';
import type { RunSupervision } from '../runs/run-supervision';
import type { DispatchTargets } from '../dispatch';

export class ProjectPanels {
  private startedProjects = new Set<string>();
  private trays = new Map<string, Panel[]>();
  constructor(
    private store: Pick<ProjectStore, 'save'>,
    private supervision: RunSupervision,
    private agents: () => Settings['agents'],
    private changed: () => void,
  ) {}
  view(project: Project): { panels: PanelView[]; tray: PanelView[] } {
    const view = (panel: Panel) => this.supervision.panelView(panel);
    return { panels: project.panels.map(view), tray: this.tray(project.id).map(view) };
  }
  all(project: Project) {
    return projectPanels({ panels: project.panels, tray: this.tray(project.id) });
  }
  private tray(projectId: string) {
    return this.trays.get(projectId) ?? [];
  }
  private startPanel(project: Project, panel: Panel, args: string[] = []) {
    const command = this.agents()[panel.agent];
    return this.supervision.start(project, panel, { ...command, args: [...command.args, ...args] });
  }
  async startOnFirstOpen(project: Project): Promise<LaunchResult[]> {
    if (this.startedProjects.has(project.id)) return [];
    this.startedProjects.add(project.id);
    const launches: LaunchResult[] = [];
    for (const panel of project.panels) launches.push(await this.startPanel(project, panel));
    return launches;
  }
  async withdraw(project: Project, launches: LaunchResult[]) {
    const panelIds = launches.filter(launch => launch.outcome === 'failed').map(launch => launch.run.panelId);
    if (panelIds.length) await this.removePanels(project, panelIds);
  }
  async restart(project: Project): Promise<{ launches: LaunchResult[]; error?: string }> {
    const launches: LaunchResult[] = [];
    if (!this.startedProjects.has(project.id)) return { launches };
    const failures = await this.supervision.stopPanels(project.panels);
    if (failures.length)
      return { launches, error: message('projectRestartFailed', { reasons: failures.map(nestedMessage) }) };
    for (const panel of project.panels) launches.push(await this.startPanel(project, panel));
    return { launches };
  }
  async arrangeIfUnlaid(project: Project, defaultLayout: Settings['defaultLayout']) {
    if (!project.layout && project.panels.length) {
      project.layout = arrange(
        project.panels.map(panel => panel.id),
        defaultLayout,
      );
      await this.store.save(project);
    }
  }
  async add(project: Project, agent: AgentType, args?: string[]): Promise<PanelCreation> {
    if (!agentTypes.includes(agent)) throw new Error(message('agentInvalid'));
    const tray = this.tray(project.id);
    if (panelLimitReached({ panels: project.panels, tray })) throw new Error(message('panelLimit'));
    const panel = { id: randomUUID(), agent };
    this.trays.set(project.id, [...tray, panel]);
    this.changed();
    const launch = await this.startPanel(project, panel, args);
    if (launch.outcome === 'failed') this.removeFromTray(project.id, panel.id);
    return { panel: structuredClone(panel), launch };
  }
  targets(project: Project): DispatchTargets {
    return {
      panel: id => {
        const panel = this.all(project).find(panel => panel.id === id);
        return panel && this.supervision.panelView(panel);
      },
      add: (agent, args) => this.add(project, agent, args),
    };
  }
  async close(project: Project, panelId: string) {
    if (!this.all(project).some(p => p.id === panelId)) throw new Error(message('panelMissing'));
    await this.supervision.stopPanel(panelId);
    await this.remove(project, panelId);
  }
  async remove(project: Project, panelId: string) {
    if (this.tray(project.id).some(panel => panel.id === panelId)) this.removeFromTray(project.id, panelId);
    else await this.removePanels(project, [panelId]);
  }
  private removeFromTray(projectId: string, panelId: string) {
    this.trays.set(
      projectId,
      this.tray(projectId).filter(panel => panel.id !== panelId),
    );
    this.supervision.releasePanels([panelId]);
    this.changed();
  }
  private async removePanels(project: Project, panelIds: string[]) {
    const next = {
      ...project,
      panels: project.panels.filter(p => !panelIds.includes(p.id)),
      layout: panelIds.reduce((layout, id) => removeFromLayout(layout, id), project.layout),
    };
    await this.store.save(next);
    Object.assign(project, next);
    this.supervision.releasePanels(panelIds);
    this.changed();
  }
  async place(project: Project, panelId: string, layout: Layout) {
    const panel = this.tray(project.id).find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    const structure = parseLayoutStructure(layout);
    const placed = layoutPanelIds(structure);
    const replaced = project.panels.filter(resident => !placed.includes(resident.id));
    const takesReplacedPosition =
      replaced.length === 1 &&
      String(panelPath(structure, panelId)) === String(panelPath(project.layout, replaced[0].id));
    if (replaced.length > 1 || (replaced.length === 1 && !takesReplacedPosition))
      throw new Error(message('layoutMismatch'));
    const panels = [...project.panels.filter(resident => !replaced.includes(resident)), panel];
    await this.changeResidency(project, { ...project, panels, layout: parseLayout(structure, panels) }, [
      ...this.tray(project.id).filter(p => p !== panel),
      ...replaced,
    ]);
  }
  async toTray(project: Project, panelId: string) {
    const panel = project.panels.find(p => p.id === panelId);
    if (!panel) throw new Error(message('panelMissing'));
    await this.changeResidency(
      project,
      {
        ...project,
        panels: project.panels.filter(p => p !== panel),
        layout: removeFromLayout(project.layout, panelId),
      },
      [...this.tray(project.id), panel],
    );
  }
  private async changeResidency(project: Project, next: Project, tray: Panel[]) {
    await this.store.save(next);
    Object.assign(project, next);
    this.trays.set(project.id, tray);
    this.changed();
  }
  async saveLayout(project: Project, layout: Layout | null) {
    project.layout = parseLayout(layout, project.panels);
    this.changed();
    await this.store.save(project);
  }
  stop(project: Project) {
    return this.supervision.stopPanels(this.all(project));
  }
  forget(project: Project) {
    this.supervision.releasePanels(this.all(project).map(panel => panel.id));
    this.trays.delete(project.id);
    this.startedProjects.delete(project.id);
  }
}
