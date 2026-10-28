// Reads the snapshot's panel views; mirrors tests/support/panel-views.ts for the desktop suite.
const panelViews = snapshot => snapshot.projects.flatMap(project => project.panels);
/** The current run of every panel that has one, in panel order. */
const runsOf = snapshot => panelViews(snapshot).flatMap(panel => panel.run ?? []);
/** The stored Project shape of every project: panel views without their run and status. */
const storedProjects = snapshot => snapshot.projects.map(project => ({ ...project, panels: project.panels.map(({ run, status, ...panel }) => panel) }));
/** The processing state the panel currently running this run displays. */
const statusOf = (snapshot, runId) => panelViews(snapshot).find(panel => panel.run?.id === runId)?.status;
/** The project's panels displaying this processing state, as [panel ID, run ID] in panel order. */
const showing = (snapshot, projectId, state) => (snapshot.projects.find(project => project.id === projectId)?.panels ?? [])
  .flatMap(panel => panel.status === state ? [[panel.id, panel.run.id]] : []);
module.exports = { panelViews, runsOf, statusOf, showing, storedProjects };
