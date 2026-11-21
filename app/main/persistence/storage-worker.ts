import { message } from '../../shared/messages';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import {
  agentTypeSchema,
  sidebars,
  sidebarPreferencesSchema,
  parseLayout,
  type Sidebar,
  type SidebarPreferences,
  type Panel,
  type Project,
} from '../../shared/model';
import { forgeIdSchema, type RepositoryReference } from '../../shared/forge/forge';
import type { DispatchRecord } from '../dispatch';

const file: string = workerData.file;
const db = new DatabaseSync(file);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
  CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL UNIQUE, layout TEXT);
  CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), agent TEXT NOT NULL, position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), active_project TEXT, navigation TEXT);
  CREATE TABLE IF NOT EXISTS bound_repositories (project_id TEXT PRIMARY KEY REFERENCES projects(id), forge TEXT NOT NULL, host TEXT NOT NULL,
    repository_id TEXT NOT NULL, path TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS forge_sidebar (id INTEGER PRIMARY KEY CHECK(id=1), preferences TEXT NOT NULL);
  -- Dispatch Records with the skill dispatched. Records earlier versions stored without the skill, in \`dispatches\`,
  -- cannot show it: that table is dropped, and nothing else with it. This table has no foreign key because an earlier
  -- version deletes projects without knowing it: its rows are read only for projects that exist.
  CREATE TABLE IF NOT EXISTS dispatches_with_skill (project_id TEXT NOT NULL, forge TEXT NOT NULL, host TEXT NOT NULL,
    repository_id TEXT NOT NULL, path TEXT NOT NULL, issue INTEGER NOT NULL, dispatched_at TEXT NOT NULL, agent TEXT NOT NULL,
    skill TEXT NOT NULL, text TEXT NOT NULL, session_id TEXT NOT NULL);
  DROP TABLE IF EXISTS dispatches;
  -- Bindings and dispatches stored without the repository's ID cannot name it: their projects are bound again
  -- (docs/adr/0006-forges-sit-behind-an-interface.md).
  DROP TABLE IF EXISTS repository_bindings;
  DROP TABLE IF EXISTS dispatch_records;
`);

// Stored content is read in its current format only: anything else fails the whole load and leaves the file untouched.
// Columns other than layout and panels.agent are kept as the table constraints store them.
function readProject(row: Record<string, unknown>): Project {
  const {
    id,
    name,
    directory,
    layout: storedLayout,
  } = row as { id: string; name: string; directory: string; layout: string };
  const invalid = (field: string) => new Error(message('projectDataInvalid', { file, field, id, name }));
  const panels = db
    .prepare('SELECT id, agent FROM panels WHERE project_id=? ORDER BY position')
    .all(id)
    .map((panel): Panel => {
      const agent = agentTypeSchema.safeParse(panel.agent);
      if (!agent.success) throw invalid('panels.agent');
      return { id: panel.id as string, agent: agent.data };
    });
  let layout;
  try {
    layout = parseLayout(JSON.parse(storedLayout), panels);
  } catch {
    throw invalid('layout');
  }
  return { id, name, directory, layout, panels };
}

/** A repository reference stored in `table`'s row: the forge must be one the Workbench has an adapter for, and host, ID and path must be set. */
function readRepository(table: string, row: Record<string, unknown>, project: Project): RepositoryReference {
  const invalid = (field: string) =>
    new Error(message('projectDataInvalid', { file, field: `${table}.${field}`, id: project.id, name: project.name }));
  const forge = forgeIdSchema.safeParse(row.forge);
  if (!forge.success) throw invalid('forge');
  for (const field of ['host', 'repository_id', 'path']) if (!row[field]) throw invalid(field);
  return { forge: forge.data, host: row.host as string, id: row.repository_id as string, path: row.path as string };
}

/** Each project's Repository Binding. */
function readBindings(projects: Project[]): Record<string, RepositoryReference> {
  const bindings: Record<string, RepositoryReference> = {};
  for (const row of db.prepare('SELECT * FROM bound_repositories').all()) {
    const project = projects.find(project => project.id === row.project_id)!;
    bindings[project.id] = readRepository('bound_repositories', row, project);
  }
  return bindings;
}

/** Every Dispatch Record, oldest first. The repository and Agent type must be ones the Workbench knows. */
function readDispatchRecords(projects: Project[]): DispatchRecord[] {
  return db
    .prepare('SELECT * FROM dispatches_with_skill WHERE project_id IN (SELECT id FROM projects) ORDER BY rowid')
    .all()
    .map(row => {
      const project = projects.find(project => project.id === row.project_id)!;
      const repository = readRepository('dispatches_with_skill', row, project);
      const agent = agentTypeSchema.safeParse(row.agent);
      if (!agent.success)
        throw new Error(
          message('projectDataInvalid', {
            file,
            field: 'dispatches_with_skill.agent',
            id: project.id,
            name: project.name,
          }),
        );
      return {
        projectId: project.id,
        repository,
        issue: row.issue as number,
        dispatchedAt: row.dispatched_at as string,
        agent: agent.data,
        skill: row.skill as string,
        text: row.text as string,
        sessionId: row.session_id as string,
      };
    });
}

/** Where each sidebar's preferences are stored; `location` names that place when what is stored there is invalid. */
const sidebarStorage: Record<Sidebar, { read: string; write: string; location: string }> = {
  navigation: {
    location: 'navigation',
    read: 'SELECT navigation AS preferences FROM workspace WHERE id=1',
    write:
      'INSERT INTO workspace (id, navigation) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET navigation=excluded.navigation',
  },
  forgeSidebar: {
    location: 'forge_sidebar',
    read: 'SELECT preferences FROM forge_sidebar WHERE id=1',
    write: 'INSERT INTO forge_sidebar VALUES (1,?) ON CONFLICT(id) DO UPDATE SET preferences=excluded.preferences',
  },
};

/** A sidebar's stored preferences, or its defaults when none are stored. */
function readSidebar(sidebar: Sidebar): SidebarPreferences {
  const { read, location: field } = sidebarStorage[sidebar];
  const stored = db.prepare(read).get()?.preferences;
  if (stored === null || stored === undefined) return sidebars[sidebar].defaults;
  try {
    return sidebarPreferencesSchema.parse(JSON.parse(stored as string));
  } catch {
    throw new Error(message('sidebarDataInvalid', { file, field }));
  }
}

function transaction(write: () => void) {
  db.exec('BEGIN IMMEDIATE');
  try {
    write();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function bind(projectId: string, repository: RepositoryReference) {
  db.prepare(
    `INSERT INTO bound_repositories VALUES (?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET forge=excluded.forge, host=excluded.host,
    repository_id=excluded.repository_id, path=excluded.path`,
  ).run(projectId, repository.forge, repository.host, repository.id, repository.path);
}

function saveProject(project: Project) {
  db.prepare(
    'INSERT INTO projects VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, directory=excluded.directory, layout=excluded.layout',
  ).run(project.id, project.name, project.directory, JSON.stringify(project.layout));
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
        bindings: readBindings(projects),
        dispatches: readDispatchRecords(projects),
        navigation: readSidebar('navigation'),
        forgeSidebar: readSidebar('forgeSidebar'),
        activeProjectId: workspace?.active_project ?? null,
      };
    } else if (operation === 'save') transaction(() => saveProject(value as Project));
    else if (operation === 'bind') {
      const { projectId, repository } = value as { projectId: string; repository: RepositoryReference };
      bind(projectId, repository);
    } else if (operation === 'unbind') {
      db.prepare('DELETE FROM bound_repositories WHERE project_id=?').run(value as string);
    } else if (operation === 'dispatch') {
      const record = value as DispatchRecord;
      const { forge, host, id: repositoryId, path } = record.repository;
      db.prepare('INSERT INTO dispatches_with_skill VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
        record.projectId,
        forge,
        host,
        repositoryId,
        path,
        record.issue,
        record.dispatchedAt,
        record.agent,
        record.skill,
        record.text,
        record.sessionId,
      );
    } else if (operation === 'delete')
      transaction(() => {
        db.prepare('DELETE FROM panels WHERE project_id=?').run(value.id);
        db.prepare('DELETE FROM dispatches_with_skill WHERE project_id=?').run(value.id);
        db.prepare('DELETE FROM bound_repositories WHERE project_id=?').run(value.id);
        db.prepare('DELETE FROM projects WHERE id=?').run(value.id);
        db.prepare(
          'INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project',
        ).run(value.activeProjectId);
      });
    else if (operation === 'active') {
      db.prepare(
        'INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project',
      ).run(value);
    } else if (operation === 'sidebar') {
      const { sidebar, preferences } = value as { sidebar: Sidebar; preferences: SidebarPreferences };
      db.prepare(sidebarStorage[sidebar].write).run(JSON.stringify(preferences));
    } else if (operation === 'close') db.close();
    else throw new Error(message('storageOperationUnknown'));
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
