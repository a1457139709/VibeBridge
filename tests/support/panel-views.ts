import type { PanelView, Project, ProjectView, Run, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';

/** The project's resident panels in panel order, then its tray panels in tray order. */
const projectPanels = (project: ProjectView): PanelView[] => [...project.panels, ...project.tray];
/** Every panel view in the snapshot, project by project: resident panels, then tray panels. */
export const panelViews = (snapshot: Snapshot): PanelView[] => snapshot.projects.flatMap(projectPanels);
/** The current run of every panel that has one, in panel order. */
export const runsOf = (snapshot: Snapshot): Run[] => panelViews(snapshot).flatMap(panel => panel.run ?? []);
/** The processing state the panel currently running this run displays. */
export const statusOf = (snapshot: Snapshot, runId: string) => panelViews(snapshot).find(panel => panel.run?.id === runId)?.status;
/** The project's panels displaying this processing state, as [panel ID, run ID]: resident panels, then tray panels. */
export const showing = (snapshot: Snapshot, projectId: string, state: ProcessingState) => {
  const project = snapshot.projects.find(project => project.id === projectId);
  return (project ? projectPanels(project) : []).flatMap(panel => panel.status === state ? [[panel.id, panel.run!.id]] : []);
};
/** The snapshot's projects in their stored shape: resident panels without run and processing state, no tray, no Repository Binding and no Forge. */
export const storedProjects = (snapshot: Snapshot): Project[] => snapshot.projects.map(({ tray: _tray, repository: _repository, forge: _forge, ...project }) => ({ ...project, panels: project.panels.map(({ run: _run, status: _status, ...panel }) => panel) }));
