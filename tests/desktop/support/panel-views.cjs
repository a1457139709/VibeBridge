const projectPanels = project => [...project.panels, ...project.tray];
const panelViews = snapshot => snapshot.projects.flatMap(projectPanels);
const runsOf = snapshot => panelViews(snapshot).flatMap(panel => panel.run ?? []);
const storedProjects = snapshot =>
  snapshot.projects.map(({ tray, ...project }) => ({
    ...project,
    panels: project.panels.map(({ run, status, ...panel }) => panel),
  }));
const statusOf = (snapshot, runId) => panelViews(snapshot).find(panel => panel.run?.id === runId)?.status;
const showing = (snapshot, projectId, state) => {
  const project = snapshot.projects.find(project => project.id === projectId);
  return (project ? projectPanels(project) : []).flatMap(panel =>
    panel.status === state ? [[panel.id, panel.run.id]] : [],
  );
};
module.exports = { panelViews, runsOf, statusOf, showing, storedProjects };
