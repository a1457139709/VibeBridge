import { message } from '../shared/messages';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { agentTypeSchema, defaultNavigation, navigationSchema, parseLayout, type NavigationPreferences, type Panel, type Project } from '../shared/model';

const file: string = workerData.file;
const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE, layout TEXT);
  CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), agent TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), active_project TEXT, navigation TEXT);
`);

// Stored content is read in its current format only: anything else fails the whole load and leaves the file untouched.
// Columns other than layout and panels.agent are kept as the table constraints store them.
function readProject(row: Record<string, unknown>): Project {
  const { id, name, directory, layout: storedLayout } = row as { id: string; name: string; directory: string; layout: string };
  const invalid = (field: string) => new Error(message('projectDataInvalid', { file, field, id, name }));
  const panels = db.prepare('SELECT id, agent FROM panels WHERE project_id=? ORDER BY position').all(id).map((panel): Panel => {
    const agent = agentTypeSchema.safeParse(panel.agent);
    if (!agent.success) throw invalid('panels.agent');
    return { id: panel.id as string, agent: agent.data };
  });
  let layout;
  try { layout = parseLayout(JSON.parse(storedLayout), panels); } catch { throw invalid('layout'); }
  return { id, name, directory, layout, panels };
}

function readNavigation(stored: unknown): NavigationPreferences {
  if (stored === null || stored === undefined) return defaultNavigation;
  try { return navigationSchema.parse(JSON.parse(stored as string)); }
  catch { throw new Error(message('navigationDataInvalid', { file, field: 'navigation' })); }
}

parentPort!.on('message', ({ id, operation, value }) => {
  try {
    let result: unknown;
    if (operation === 'load') {
      const workspace = db.prepare('SELECT navigation, active_project FROM workspace WHERE id=1').get();
      result = {
        projects: db.prepare('SELECT * FROM projects ORDER BY rowid').all().map(readProject),
        navigation: readNavigation(workspace?.navigation),
        activeProjectId: workspace?.active_project ?? null,
      };
    } else if (operation === 'save') {
      const project = value as Project;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, directory=excluded.directory, layout=excluded.layout')
          .run(project.id, project.name, project.directory, JSON.stringify(project.layout));
        db.prepare('DELETE FROM panels WHERE project_id=?').run(project.id);
        const insert = db.prepare('INSERT INTO panels VALUES (?,?,?,?)');
        project.panels.forEach((panel, position) => insert.run(panel.id, project.id, panel.agent, position));
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (operation === 'delete') {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM panels WHERE project_id=?').run(value.id);
        db.prepare('DELETE FROM projects WHERE id=?').run(value.id);
        db.prepare('INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project').run(value.activeProjectId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    } else if (operation === 'active') {
      db.prepare('INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project').run(value);
    } else if (operation === 'navigation') {
      db.prepare('INSERT INTO workspace (id, navigation) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET navigation=excluded.navigation').run(JSON.stringify(value));
    } else if (operation === 'close') db.close();
    else throw new Error(message('storageOperationUnknown'));
    parentPort!.postMessage({ id, result });
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
