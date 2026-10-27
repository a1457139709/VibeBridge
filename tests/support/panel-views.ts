import type { PanelView, Project, Run, Snapshot } from '../../app/shared/model';
import type { ProcessingState } from '../../app/shared/processing-status';

/** Every panel view in the snapshot, project by project, in panel order. */
export const panelViews = (snapshot: Snapshot): PanelView[] => snapshot.projects.flatMap(project => project.panels);
/** The current run of every panel that has one, in panel order. */
export const runsOf = (snapshot: Snapshot): Run[] => panelViews(snapshot).flatMap(panel => panel.run ?? []);
/** The processing state the panel currently running this run displays. */
export const statusOf = (snapshot: Snapshot, runId: string) => panelViews(snapshot).find(panel => panel.run?.id === runId)?.status;
/** The project's panels displaying this processing state, as [panel ID, run ID] in panel order. */
export const showing = (snapshot: Snapshot, projectId: string, state: ProcessingState) => (snapshot.projects.find(project => project.id === projectId)?.panels ?? [])
  .flatMap(panel => panel.status === state ? [[panel.id, panel.run!.id]] : []);
/** The snapshot's projects in their stored shape, without each panel's run and processing state. */
export const storedProjects = (snapshot: Snapshot): Project[] => snapshot.projects.map(project => ({ ...project, panels: project.panels.map(({ run: _run, status: _status, ...panel }) => panel) }));
