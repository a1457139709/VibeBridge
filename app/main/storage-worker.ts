import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { defaultNavigation, type Project } from '../shared/model';

const db = new DatabaseSync(workerData.file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE, layout TEXT);
  CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), agent TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), active_project TEXT);
`);

const columns = db.prepare('PRAGMA table_info(workspace)').all();
if (!columns.some(column => column.name === 'navigation')) db.exec('ALTER TABLE workspace ADD COLUMN navigation TEXT');

parentPort!.on('message', ({ id, operation, value }) => {
  try {
    let result: unknown;
    if (operation === 'load') {
      result = {
        projects: db.prepare('SELECT * FROM projects ORDER BY rowid').all().map(row => ({
          id: row.id, name: row.name, directory: row.directory, layout: JSON.parse(row.layout as string),
          panels: db.prepare('SELECT id, agent FROM panels WHERE project_id=? ORDER BY position').all(row.id),
        })),
        navigation: JSON.parse(db.prepare('SELECT navigation FROM workspace WHERE id=1').get()?.navigation as string || 'null') ?? defaultNavigation,
        activeProjectId: db.prepare('SELECT active_project FROM workspace WHERE id=1').get()?.active_project ?? null,
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
    else throw new Error('未知保存操作');
    parentPort!.postMessage({ id, result });
  } catch (error) { parentPort!.postMessage({ id, error: String(error) }); }
});
