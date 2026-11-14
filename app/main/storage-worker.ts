import { message } from '../shared/messages';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { agentTypeSchema, sidebars, sidebarPreferencesSchema, parseLayout, type Sidebar, type SidebarPreferences, type Panel, type Project } from '../shared/model';
import { forgeIdSchema, type RepositoryReference } from '../shared/forge';
import type { DispatchRecord } from './dispatch';

const file: string = workerData.file;
const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE, layout TEXT);
  CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), agent TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), active_project TEXT, navigation TEXT);
  CREATE TABLE IF NOT EXISTS repository_bindings (project_id TEXT PRIMARY KEY REFERENCES projects(id), forge TEXT NOT NULL, path TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS forge_sidebar (id INTEGER PRIMARY KEY CHECK(id=1), preferences TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dispatch_records (project_id TEXT NOT NULL REFERENCES projects(id), forge TEXT NOT NULL, path TEXT NOT NULL,
    issue INTEGER NOT NULL, dispatched_at TEXT NOT NULL, agent TEXT NOT NULL, text TEXT NOT NULL, session_id TEXT NOT NULL);
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

/** Each project's Repository Binding: the forge must be one the Workbench has an adapter for. */
function readBindings(projects: Project[]): Record<string, RepositoryReference> {
  const bindings: Record<string, RepositoryReference> = {};
  for (const row of db.prepare('SELECT project_id, forge, path FROM repository_bindings').all()) {
    const project = projects.find(project => project.id === row.project_id)!;
    const forge = forgeIdSchema.safeParse(row.forge);
    if (!forge.success) throw new Error(message('projectDataInvalid', { file, field: 'repository_bindings.forge', id: project.id, name: project.name }));
    if (!row.path) throw new Error(message('projectDataInvalid', { file, field: 'repository_bindings.path', id: project.id, name: project.name }));
    bindings[project.id] = { forge: forge.data, path: row.path as string };
  }
  return bindings;
}

/** Every Dispatch Record, oldest first. The forge and Agent type must be ones the Workbench knows. */
function readDispatchRecords(projects: Project[]): DispatchRecord[] {
  return db.prepare('SELECT * FROM dispatch_records ORDER BY rowid').all().map(row => {
    const project = projects.find(project => project.id === row.project_id)!;
    const invalid = (field: string) => new Error(message('projectDataInvalid', { file, field: `dispatch_records.${field}`, id: project.id, name: project.name }));
    const forge = forgeIdSchema.safeParse(row.forge);
    if (!forge.success) throw invalid('forge');
    const agent = agentTypeSchema.safeParse(row.agent);
    if (!agent.success) throw invalid('agent');
    return { projectId: project.id, repository: { forge: forge.data, path: row.path as string }, issue: row.issue as number,
      dispatchedAt: row.dispatched_at as string, agent: agent.data, text: row.text as string, sessionId: row.session_id as string };
  });
}

/** Where each sidebar's preferences are stored; `field` names that place when what is stored there is invalid. */
const sidebarStorage: Record<Sidebar, { read: string; write: string; field: string }> = {
  navigation: { field: 'navigation', read: 'SELECT navigation AS preferences FROM workspace WHERE id=1',
    write: 'INSERT INTO workspace (id, navigation) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET navigation=excluded.navigation' },
  forgeSidebar: { field: 'forge_sidebar', read: 'SELECT preferences FROM forge_sidebar WHERE id=1',
    write: 'INSERT INTO forge_sidebar VALUES (1,?) ON CONFLICT(id) DO UPDATE SET preferences=excluded.preferences' },
};

/** A sidebar's stored preferences, or its defaults when none are stored. */
function readSidebar(sidebar: Sidebar): SidebarPreferences {
  const { read, field } = sidebarStorage[sidebar];
  const stored = db.prepare(read).get()?.preferences;
  if (stored === null || stored === undefined) return sidebars[sidebar].defaults;
  try { return sidebarPreferencesSchema.parse(JSON.parse(stored as string)); }
  catch { throw new Error(message('sidebarDataInvalid', { file, field })); }
}

function transaction(write: () => void) {
  db.exec('BEGIN IMMEDIATE');
  try { write(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function saveProject(project: Project) {
  db.prepare('INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, directory=excluded.directory, layout=excluded.layout')
    .run(project.id, project.name, project.directory, JSON.stringify(project.layout));
  db.prepare('DELETE FROM panels WHERE project_id=?').run(project.id);
  const insert = db.prepare('INSERT INTO panels VALUES (?,?,?,?)');
  project.panels.forEach((panel, position) => insert.run(panel.id, project.id, panel.agent, position));
}

parentPort!.on('message', ({ id, operation, value }) => {
  try {
    let result: unknown;
    if (operation === 'load') {
      const workspace = db.prepare('SELECT active_project FROM workspace WHERE id=1').get();
      const projects = db.prepare('SELECT * FROM projects ORDER BY rowid').all().map(readProject);
      result = {
        projects,
        repositories: readBindings(projects),
        dispatches: readDispatchRecords(projects),
        navigation: readSidebar('navigation'),
        forgeSidebar: readSidebar('forgeSidebar'),
        activeProjectId: workspace?.active_project ?? null,
      };
    } else if (operation === 'save') transaction(() => saveProject(value as Project));
    else if (operation === 'edit') {
      const { project, repository } = value as { project: Project; repository: RepositoryReference | null };
      transaction(() => {
        saveProject(project);
        if (repository) db.prepare('INSERT INTO repository_bindings VALUES (?,?,?) ON CONFLICT(project_id) DO UPDATE SET forge=excluded.forge, path=excluded.path')
          .run(project.id, repository.forge, repository.path);
        else db.prepare('DELETE FROM repository_bindings WHERE project_id=?').run(project.id);
      });
    } else if (operation === 'dispatch') {
      const record = value as DispatchRecord;
      db.prepare('INSERT INTO dispatch_records VALUES (?,?,?,?,?,?,?,?)').run(record.projectId, record.repository.forge, record.repository.path,
        record.issue, record.dispatchedAt, record.agent, record.text, record.sessionId);
    } else if (operation === 'delete') transaction(() => {
      db.prepare('DELETE FROM panels WHERE project_id=?').run(value.id);
      db.prepare('DELETE FROM dispatch_records WHERE project_id=?').run(value.id);
      db.prepare('DELETE FROM repository_bindings WHERE project_id=?').run(value.id);
      db.prepare('DELETE FROM projects WHERE id=?').run(value.id);
      db.prepare('INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project').run(value.activeProjectId);
    });
    else if (operation === 'active') {
      db.prepare('INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project').run(value);
    } else if (operation === 'sidebar') {
      const { sidebar, preferences } = value as { sidebar: Sidebar; preferences: SidebarPreferences };
      db.prepare(sidebarStorage[sidebar].write).run(JSON.stringify(preferences));
    } else if (operation === 'close') db.close();
    else throw new Error(message('storageOperationUnknown'));
    parentPort!.postMessage({ id, result });
  } catch (error) { parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
});
