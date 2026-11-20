import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Workbench, WorkbenchOpenError } from '../app/main/workbench';
import { testDirectory } from './support/directory';
import { storedProjects } from './support/panel-views';

const project = { id: 'project-a', name: 'Stored' };
const layout = { axis: 'row', ratio: 0.5, first: { panel: 'panel-a' }, second: { panel: 'panel-b' } };

// The database schema comes from the workbench itself; rows are written directly to stand in for stored content.
async function storedWorkbench(context: TestContext, scope: string, change: (database: DatabaseSync) => void) {
  const directory = await testDirectory(context, scope);
  await (await Workbench.open(directory)).quit();
  const file = join(directory, 'projects.sqlite');
  const database = new DatabaseSync(file);
  try {
    database
      .prepare('INSERT INTO projects VALUES (?,?,?,?)')
      .run(project.id, project.name, directory, JSON.stringify(layout));
    database.prepare('INSERT INTO panels VALUES (?,?,?,?)').run('panel-a', project.id, 'codex', 0);
    database.prepare('INSERT INTO panels VALUES (?,?,?,?)').run('panel-b', project.id, 'claude', 1);
    change(database);
  } finally {
    database.close();
  }
  return { directory, file };
}

/** Opening fails with the given message, which names the database and each expected detail, and the database is unchanged. */
async function assertRejected(directory: string, file: string, reason: RegExp, details: string[]) {
  const before = await readFile(file);
  const error = await Workbench.open(directory).then(
    async workbench => {
      await workbench.quit();
    },
    (error: unknown) => error,
  );
  assert.ok(error instanceof WorkbenchOpenError, 'the workbench opened');
  assert.match(error.message, reason);
  for (const text of [file, ...details]) assert.ok(error.message.includes(text), `${text} in ${error.message}`);
  assert.deepEqual(await readFile(file), before);
}

test('projects without panels and navigation that was never saved reopen as stored', async context => {
  const directory = await testDirectory(context, 'stored-current-format');
  let workbench = await Workbench.open(directory);
  try {
    const agents = workbench.snapshot().settings.agents;
    agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings({ agents });
    await workbench.createProject({ name: 'Arranged', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    await mkdir(join(directory, 'empty'));
    const { project: empty } = await workbench.createProject({
      name: 'Empty',
      directory: join(directory, 'empty'),
      total: 1,
      counts: { codex: 1, claude: 0, pi: 0 },
    });
    await workbench.closePanel(empty.id, empty.panels[0].id);
    const stored = storedProjects(workbench.snapshot());
    assert.equal(stored[1].layout, null);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(storedProjects(workbench.snapshot()), stored);
    assert.equal(workbench.snapshot().activeProjectId, empty.id);
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 212 });
  } finally {
    await workbench.quit();
  }
});

test('a stored panel with an unknown Agent type keeps the workbench closed and the database unchanged', async context => {
  const { directory, file } = await storedWorkbench(context, 'stored-unknown-agent', database =>
    database.prepare('UPDATE panels SET agent=? WHERE id=?').run('gemini', 'panel-b'),
  );
  await assertRejected(directory, file, /projectDataInvalid/, ['panels.agent', project.id, project.name]);
});

for (const [behavior, stored] of [
  ['is not JSON', '{"axis":'],
  ['has an invalid structure', JSON.stringify({ ...layout, ratio: 1 })],
  ['does not place every stored panel', JSON.stringify(layout.first)],
  ['has keys outside the layout format', JSON.stringify({ ...layout, weight: 1 })],
]) {
  test(`a stored layout that ${behavior} keeps the workbench closed and the database unchanged`, async context => {
    const { directory, file } = await storedWorkbench(context, 'stored-invalid-layout', database =>
      database.prepare('UPDATE projects SET layout=? WHERE id=?').run(stored, project.id),
    );
    await assertRejected(directory, file, /projectDataInvalid/, ['layout', project.id, project.name]);
  });
}

for (const [behavior, stored] of [
  ['misses a field', JSON.stringify({ visible: true })],
  ['has keys outside the navigation format', JSON.stringify({ visible: true, width: 240, pinned: false })],
]) {
  test(`stored navigation preferences that ${behavior} keep the workbench closed and the database unchanged`, async context => {
    const { directory, file } = await storedWorkbench(context, 'stored-invalid-navigation', database =>
      database.prepare('INSERT INTO workspace (id, navigation) VALUES (1,?)').run(stored),
    );
    await assertRejected(directory, file, /sidebarDataInvalid/, ['navigation']);
  });
}

const storedBinding = ['github', 'github.com', '42', 'group/sub/repo'];
for (const [behavior, row, field] of [
  ['names a forge without an adapter', ['gitlab', 'gitlab.com', '42', 'group/sub/repo'], 'bound_repositories.forge'],
  ['has an empty host', ['github', '', '42', 'group/sub/repo'], 'bound_repositories.host'],
  ['has an empty repository ID', ['github', 'github.com', '', 'group/sub/repo'], 'bound_repositories.repository_id'],
  ['has an empty repository path', ['github', 'github.com', '42', ''], 'bound_repositories.path'],
] as const) {
  test(`a stored Repository Binding that ${behavior} keeps the workbench closed and the database unchanged`, async context => {
    const { directory, file } = await storedWorkbench(context, 'stored-invalid-binding', database =>
      database.prepare('INSERT INTO bound_repositories VALUES (?,?,?,?,?)').run(project.id, ...row),
    );
    await assertRejected(directory, file, /projectDataInvalid/, [field, project.id, project.name]);
  });
}

test('a stored Repository Binding with a nested repository path reopens as stored', async context => {
  const { directory } = await storedWorkbench(context, 'stored-binding', database =>
    database.prepare('INSERT INTO bound_repositories VALUES (?,?,?,?,?)').run(project.id, ...storedBinding),
  );
  const workbench = await Workbench.open(directory);
  try {
    assert.deepEqual(workbench.snapshot().projects[0].repository, {
      forge: 'github',
      host: 'github.com',
      id: '42',
      path: 'group/sub/repo',
    });
  } finally {
    await workbench.quit();
  }
});

test('dispatch records an earlier version stored without their skill are not shown, and stay stored for it', async context => {
  const repository = { forge: 'github', host: 'github.com', id: '42', path: 'octo/tools' };
  const { directory, file } = await storedWorkbench(context, 'stored-without-skill', database =>
    database.exec(`
    CREATE TABLE dispatches (project_id TEXT NOT NULL REFERENCES projects(id), forge TEXT NOT NULL, host TEXT NOT NULL,
      repository_id TEXT NOT NULL, path TEXT NOT NULL, issue INTEGER NOT NULL, dispatched_at TEXT NOT NULL, agent TEXT NOT NULL,
      text TEXT NOT NULL, session_id TEXT NOT NULL);
    INSERT INTO bound_repositories VALUES ('${project.id}', 'github', 'github.com', '42', 'octo/tools');
    INSERT INTO dispatches VALUES ('${project.id}', 'github', 'github.com', '42', 'octo/tools', 7, '2026-01-01T00:00:00Z',
      'claude', '/implement', 'session-a');`),
  );
  const workbench = await Workbench.open(directory);
  try {
    const [stored] = workbench.snapshot().projects;
    assert.deepEqual([stored.name, stored.repository, stored.dispatches], [project.name, repository, []]);
  } finally {
    await workbench.quit();
  }
  const database = new DatabaseSync(file);
  try {
    assert.deepEqual(
      database
        .prepare('SELECT session_id FROM dispatches')
        .all()
        .map(row => row.session_id),
      ['session-a'],
    );
  } finally {
    database.close();
  }
});

test('a project with dispatch records an earlier version stored can be deleted', async context => {
  const { directory } = await storedWorkbench(context, 'delete-with-earlier-dispatches', database =>
    database.exec(`
    CREATE TABLE dispatches (project_id TEXT NOT NULL REFERENCES projects(id), forge TEXT NOT NULL, host TEXT NOT NULL,
      repository_id TEXT NOT NULL, path TEXT NOT NULL, issue INTEGER NOT NULL, dispatched_at TEXT NOT NULL, agent TEXT NOT NULL,
      text TEXT NOT NULL, session_id TEXT NOT NULL);
    INSERT INTO dispatches VALUES ('${project.id}', 'github', 'github.com', '42', 'octo/tools', 7, '2026-01-01T00:00:00Z',
      'claude', '/implement', 'session-a');`),
  );
  let workbench = await Workbench.open(directory);
  try {
    await workbench.deleteProject(project.id);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, []);
  } finally {
    await workbench.quit();
  }
});

test('dispatch records of a project an earlier version deleted are not read', async context => {
  const { directory } = await storedWorkbench(context, 'dispatches-of-deleted-project', database =>
    database.exec(`
    INSERT INTO dispatches_with_skill VALUES ('project-gone', 'github', 'github.com', '42', 'octo/tools', 7,
      '2026-01-01T00:00:00Z', 'claude', 'implement', '/implement', 'session-a');`),
  );
  const workbench = await Workbench.open(directory);
  try {
    const [stored] = workbench.snapshot().projects;
    assert.deepEqual([stored.name, stored.dispatches], [project.name, []]);
  } finally {
    await workbench.quit();
  }
});

test('bindings and dispatches stored without the repository ID are dropped: the project reopens unbound and can be deleted', async context => {
  const { directory } = await storedWorkbench(context, 'stored-without-repository-id', database =>
    database.exec(`
    CREATE TABLE repository_bindings (project_id TEXT PRIMARY KEY REFERENCES projects(id), forge TEXT NOT NULL, path TEXT NOT NULL);
    CREATE TABLE dispatch_records (project_id TEXT NOT NULL REFERENCES projects(id), forge TEXT NOT NULL, path TEXT NOT NULL,
      issue INTEGER NOT NULL, dispatched_at TEXT NOT NULL, agent TEXT NOT NULL, text TEXT NOT NULL, session_id TEXT NOT NULL);
    INSERT INTO repository_bindings VALUES ('${project.id}', 'github', 'octo/tools');
    INSERT INTO dispatch_records VALUES ('${project.id}', 'github', 'octo/tools', 7, '2026-01-01T00:00:00Z', 'claude', '/implement', 'session-a');`),
  );
  let workbench = await Workbench.open(directory);
  try {
    const [stored] = workbench.snapshot().projects;
    assert.deepEqual([stored.name, stored.repository, stored.dispatches], [project.name, null, []]);
    await workbench.deleteProject(project.id);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, []);
  } finally {
    await workbench.quit();
  }
});
