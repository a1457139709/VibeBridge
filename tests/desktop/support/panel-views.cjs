// Reads the snapshot's panel views; mirrors tests/support/panel-views.ts for the desktop suite.
const projectPanels = project => [...project.panels, ...project.tray];
/** Every panel view in the snapshot, project by project: resident panels, then tray panels. */
const panelViews = snapshot => snapshot.projects.flatMap(projectPanels);
/** The current run of every panel that has one, in panel order. */
const runsOf = snapshot => panelViews(snapshot).flatMap(panel => panel.run ?? []);
/** The stored Project shape of every project: resident panel views without their run and status, and no tray. */
const storedProjects = snapshot => snapshot.projects.map(({ tray, dispatches, ...project }) => ({ ...project, panels: project.panels.map(({ run, status, ...panel }) => panel) }));
/** The processing state the panel currently running this run displays. */
const statusOf = (snapshot, runId) => panelViews(snapshot).find(panel => panel.run?.id === runId)?.status;
/** The project's panels displaying this processing state, as [panel ID, run ID]: resident panels, then tray panels. */
const showing = (snapshot, projectId, state) => {
  const project = snapshot.projects.find(project => project.id === projectId);
  return (project ? projectPanels(project) : []).flatMap(panel => panel.status === state ? [[panel.id, panel.run.id]] : []);
};
module.exports = { panelViews, runsOf, statusOf, showing, storedProjects };
