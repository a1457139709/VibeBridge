import { message } from '../../shared/messages';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
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
import type { StorageRequest } from './storage';
import { errorMessage } from '../../shared/caught-error';

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
// Columns other than layout, panels.agent and the repository's are read as the tables declare them; SQLite stores what
// it is given, so one that holds something else is reported like any other invalid field.
const projectRowSchema = z.object({ id: z.string(), name: z.string(), directory: z.string(), layout: z.unknown() });
const panelRowSchema = z.object({ id: z.string(), agent: z.unknown() });
const dispatchRowSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  issue: z.number(),
  dispatched_at: z.string(),
  agent: z.unknown(),
  skill: z.string(),
  text: z.string(),
  session_id: z.string(),
});
const filledSchema = z.string().min(1);

/** The project a stored row belongs to, as an invalid row names it. */
interface StoredProject {
  id: string;
  name: string;
}

const invalidProjectData = (project: StoredProject, field: string) =>
  new Error(message('projectDataInvalid', { file, field, id: project.id, name: project.name }));

/** `stored`, a row of `table` that belongs to `project`, as `schema` reads it; the first column `schema` does not
 * accept is reported as the project's invalid field. */
function readRow<Row>(schema: z.ZodType<Row>, stored: Record<string, unknown>, table: string, project: StoredProject) {
  const row = schema.safeParse(stored);
  if (!row.success) throw invalidProjectData(project, `${table}.${String(row.error.issues[0]?.path[0])}`);
  return row.data;
}

function readProject(row: Record<string, unknown>): Project {
  const owner = { id: String(row.id), name: String(row.name) };
  const { id, name, directory, layout: storedLayout } = readRow(projectRowSchema, row, 'projects', owner);
  const panels = db
    .prepare('SELECT id, agent FROM panels WHERE project_id=? ORDER BY position')
    .all(id)
    .map((stored): Panel => {
      const panel = readRow(panelRowSchema, stored, 'panels', { id, name });
      const agent = agentTypeSchema.safeParse(panel.agent);
      if (!agent.success) throw invalidProjectData({ id, name }, 'panels.agent');
      return { id: panel.id, agent: agent.data };
    });
  let layout;
  try {
    layout = parseLayout(JSON.parse(z.string().parse(storedLayout)), panels);
  } catch {
    throw invalidProjectData({ id, name }, 'layout');
  }
  return { id, name, directory, layout, panels };
}

/** A repository reference stored in `table`'s row: the forge must be one the Workbench has an adapter for, and host, ID and path must be set. */
function readRepository(table: string, row: Record<string, unknown>, project: StoredProject): RepositoryReference {
  const filled = (field: string) => {
    const value = filledSchema.safeParse(row[field]);
    if (!value.success) throw invalidProjectData(project, `${table}.${field}`);
    return value.data;
  };
  const forge = forgeIdSchema.safeParse(row.forge);
  if (!forge.success) throw invalidProjectData(project, `${table}.forge`);
  return { forge: forge.data, host: filled('host'), id: filled('repository_id'), path: filled('path') };
}

/** Each project's Repository Binding. */
function readBindings(projects: Project[]): Record<string, RepositoryReference> {
  const bindings: Record<string, RepositoryReference> = {};
  const read = db.prepare('SELECT * FROM bound_repositories WHERE project_id=?');
  for (const project of projects) {
    const row = read.get(project.id);
    if (row) bindings[project.id] = readRepository('bound_repositories', row, project);
  }
  return bindings;
}

/** Every Dispatch Record of a project that exists, oldest first. The repository and Agent type must be ones the
 * Workbench knows. */
function readDispatchRecords(): DispatchRecord[] {
  return db
    .prepare(
      `SELECT dispatches_with_skill.*, projects.name AS project_name FROM dispatches_with_skill
      JOIN projects ON projects.id = dispatches_with_skill.project_id ORDER BY dispatches_with_skill.rowid`,
    )
    .all()
    .map(stored => {
      const project = { id: String(stored.project_id), name: String(stored.project_name) };
      const row = readRow(dispatchRowSchema, stored, 'dispatches_with_skill', project);
      const repository = readRepository('dispatches_with_skill', stored, project);
      const agent = agentTypeSchema.safeParse(row.agent);
      if (!agent.success) throw invalidProjectData(project, 'dispatches_with_skill.agent');
      return {
        projectId: project.id,
        repository,
        issue: row.issue,
        dispatchedAt: row.dispatched_at,
        agent: agent.data,
        skill: row.skill,
        text: row.text,
        sessionId: row.session_id,
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
    return sidebarPreferencesSchema.parse(JSON.parse(z.string().parse(stored)));
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

function saveActiveProject(projectId: string | null) {
  db.prepare(
    'INSERT INTO workspace (id, active_project) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET active_project=excluded.active_project',
  ).run(projectId);
}

function appendDispatchRecord(record: DispatchRecord) {
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
}

function deleteProject(projectId: string, nextActiveProjectId: string | null) {
  transaction(() => {
    db.prepare('DELETE FROM panels WHERE project_id=?').run(projectId);
    db.prepare('DELETE FROM dispatches_with_skill WHERE project_id=?').run(projectId);
    db.prepare('DELETE FROM bound_repositories WHERE project_id=?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id=?').run(projectId);
    saveActiveProject(nextActiveProjectId);
  });
}

/** Carries out a request: the stored content for a load, nothing for a write. */
function perform(request: StorageRequest): unknown {
  switch (request.operation) {
    case 'load': {
      const workspace = db.prepare('SELECT active_project FROM workspace WHERE id=1').get();
      const projects = db.prepare('SELECT * FROM projects ORDER BY rowid').all().map(readProject);
      return {
        projects,
        bindings: readBindings(projects),
        dispatches: readDispatchRecords(),
        navigation: readSidebar('navigation'),
        forgeSidebar: readSidebar('forgeSidebar'),
        activeProjectId: workspace?.active_project ?? null,
      };
    }
    case 'save':
      return transaction(() => saveProject(request.project));
    case 'bind':
      return bind(request.projectId, request.repository);
    case 'unbind':
      db.prepare('DELETE FROM bound_repositories WHERE project_id=?').run(request.projectId);
      return;
    case 'dispatch':
      return appendDispatchRecord(request.record);
    case 'delete':
      return deleteProject(request.projectId, request.nextActiveProjectId);
    case 'active':
      return saveActiveProject(request.projectId);
    case 'sidebar':
      db.prepare(sidebarStorage[request.sidebar].write).run(JSON.stringify(request.preferences));
      return;
    case 'close':
      return db.close();
    default:
      throw new Error(message('storageOperationUnknown'));
  }
}

const port = parentPort;
if (!port) throw new Error("The storage worker runs only as the Project Store's worker thread");
// Requests come only from the Project Store in this process, typed by the protocol both sides share.
port.on('message', ({ id, request }: { id: number; request: StorageRequest }) => {
  try {
    port.postMessage({ id, result: perform(request) });
  } catch (error) {
    port.postMessage({ id, error: errorMessage(error) });
  }
});
