import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { Project, WorkbenchEvent } from '../app/shared/model';
import { runsOf, storedProjects } from './support/panel-views';

async function until(check: () => boolean, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for project management');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function fixture() {
  const directory = await mkdtemp(resolve('work/project-management-'));
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => events.push(event));
  const settings = workbench.snapshot().settings;
  for (const agent of ['codex', 'claude', 'pi'] as const) settings.agents[agent] = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
  await workbench.saveSettings(settings);
  return { directory, workbench, events,
    output: (id: string) => events.filter(e => e.kind === 'output' && e.runId === id).map(e => e.kind === 'output' ? e.data : '').join(''),
    create: (name: string, path = directory, total = 1) => workbench.createProject({ name, directory: path, total, counts: { codex: total, claude: 0, pi: 0 } }),
    close: async () => { await workbench.quit(); await rm(directory, { recursive: true, force: true }); } };
}

test('editing a name or the same real directory preserves panels, layout and the live run', async () => {
  const f = await fixture();
  try {
    const { project } = await f.create('Original');
    const before = f.workbench.snapshot();
    const link = join(f.directory, 'alias');
    await symlink(f.directory, link);
    const edited = await f.workbench.editProject(project.id, { name: ' Renamed ', directory: link }, true);
    assert.deepEqual(edited.project, { ...project, name: 'Renamed' });
    assert.deepEqual(edited.launches, []);
    assert.deepEqual(runsOf(f.workbench.snapshot()), runsOf(before));
    await f.workbench.sendInput(runsOf(before)[0].id, 'rename-survives');
    await until(() => f.output(runsOf(before)[0].id).includes('INPUT:rename-survives'));
    await f.workbench.editProject(project.id, { name: 'Renamed', directory: link }, false);
    assert.deepEqual(runsOf(f.workbench.snapshot()), runsOf(before));
    for (const name of ['', '  ', 'line\nbreak', 'bad\u001bname']) {
      await assert.rejects(f.workbench.editProject(project.id, { name, directory: f.directory }, false), /nameRequired|nameControls/);
    }
    const file = join(f.directory, 'file'); await writeFile(file, 'keep');
    for (const directory of ['', file, join(f.directory, 'missing')]) {
      await assert.rejects(f.workbench.editProject(project.id, { name: 'Invalid', directory }, false), /projectDirectoryInvalid|projectDuplicate/);
    }
    assert.equal(f.workbench.snapshot().projects[0].name, 'Renamed');
  } finally { await f.close(); }
});

test('directory restart saves first, cleans descendants and preserves project layout while isolating another project', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'), other = join(f.directory, 'other');
    await mkdir(target); await mkdir(other);
    const { project } = await f.create('Original', f.directory, 2);
    const { project: second } = await f.create('Other', other);
    const layout = { axis: 'row' as const, ratio: 0.31, first: { panel: project.panels[1].id }, second: { panel: project.panels[0].id } };
    await f.workbench.saveLayout(project.id, layout);
    const before = runsOf(f.workbench.snapshot()), oldRuns = before.filter(run => run.projectId === project.id);
    await until(() => oldRuns.every(run => f.output(run.id).includes('READY:')));
    await f.workbench.sendInput(oldRuns[0].id, 'child');
    await until(() => /CHILD:(\d+)/.test(f.output(oldRuns[0].id)));
    const child = Number(f.output(oldRuns[0].id).match(/CHILD:(\d+)/)![1]);
    const result = await f.workbench.editProject(project.id, { name: 'New directory', directory: target }, true);
    assert.equal(result.error, undefined);
    assert.equal(result.launches.length, 2);
    assert.ok(result.launches.every(launch => launch.outcome === 'started'));
    assert.deepEqual(result.project, { ...project, name: 'New directory', directory: target, layout });
    assert.ok([...oldRuns.map(run => run.pid!), child].every(pid => !alive(pid)));
    assert.deepEqual(runsOf(f.workbench.snapshot()).filter(run => run.projectId === second.id), before.filter(run => run.projectId === second.id));
    const restarted = result.launches.map(launch => launch.run);
    assert.ok(restarted.every(run => !oldRuns.some(old => old.id === run.id)));
    await until(() => restarted.every(run => f.output(run.id).includes(`:${target}`)));
    assert.deepEqual(storedProjects(f.workbench.snapshot()).find(item => item.id === project.id)?.layout, layout);
    // Natural exit still removes its panel after a controlled restart.
    await f.workbench.sendInput(restarted[0].id, 'exit');
    await until(() => f.workbench.snapshot().projects.find(item => item.id === project.id)!.panels.length === 1);
  } finally { await f.close(); }
});

test('changing directory without restart keeps original cwd and identity and uses the saved directory for later panels and visits', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'), other = join(f.directory, 'other'); await mkdir(target); await mkdir(other);
    const { project } = await f.create('Original');
    const old = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(old.id).includes(`:${f.directory}`));
    const { project: second } = await f.create('Other', other);
    await assert.rejects(f.workbench.editProject(project.id, { name: 'Duplicate', directory: other }, false), /Other/);
    const result = await f.workbench.editProject(project.id, { name: 'Moved', directory: target }, false);
    assert.deepEqual(result.launches, []);
    await f.workbench.activateProject(project.id); await f.workbench.activateProject(second.id); await f.workbench.activateProject(project.id);
    assert.deepEqual(runsOf(f.workbench.snapshot()).find(run => run.id === old.id), old);
    await f.workbench.sendInput(old.id, 'cwd-report');
    await until(() => f.output(old.id).includes(`CWD:${f.directory}`));
    const added = await f.workbench.addPanel(project.id, 'codex');
    await until(() => f.output(added.launch.run.id).includes(`:${target}`));
    assert.equal(f.workbench.snapshot().projects.find(item => item.id === project.id)!.panels.length, 2);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    const outputs: string[] = [];
    reopened.subscribe(event => { if (event.kind === 'output') outputs.push(event.data); });
    try {
      // A project which has not been visited this app run must only save.
      const before = reopened.snapshot().projects.find(item => item.id === project.id)!;
      const saved = await reopened.editProject(project.id, { name: 'Unvisited', directory: f.directory }, true);
      assert.deepEqual(saved.launches, []); assert.deepEqual(runsOf(reopened.snapshot()), []);
      assert.deepEqual(saved.project.panels, before.panels);
      await reopened.activateProject(project.id);
      await until(() => outputs.join('').includes(`:${f.directory}`));
      assert.equal(runsOf(reopened.snapshot()).length, 2);
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('deletion cleans only the target project, preserves files, persists removal and chooses its next then previous neighbour', async () => {
  const f = await fixture();
  try {
    const paths = ['first', 'middle', 'last'].map(name => join(f.directory, name));
    await Promise.all(paths.map(path => mkdir(path)));
    await writeFile(join(paths[1], 'cli-history'), 'retained history');
    const projects: Project[] = [];
    for (let i = 0; i < paths.length; i++) projects.push((await f.create(['First', 'Middle', 'Last'][i], paths[i])).project);
    await f.workbench.activateProject(projects[1].id);
    const before = runsOf(f.workbench.snapshot()), target = before.find(run => run.projectId === projects[1].id)!;
    await until(() => f.output(target.id).includes('READY:'));
    await f.workbench.sendInput(target.id, 'orphan');
    await until(() => /ORPHAN:(\d+)/.test(f.output(target.id)));
    const orphan = Number(f.output(target.id).match(/ORPHAN:(\d+)/)![1]);
    await f.workbench.deleteProject(projects[1].id);
    assert.equal(f.workbench.snapshot().activeProjectId, projects[2].id);
    assert.deepEqual(storedProjects(f.workbench.snapshot()), [projects[0], projects[2]]);
    assert.deepEqual(runsOf(f.workbench.snapshot()), before.filter(run => run.projectId !== projects[1].id));
    assert.equal(alive(target.pid!), false); assert.equal(alive(orphan), false);
    assert.equal(await readFile(join(paths[1], 'cli-history'), 'utf8'), 'retained history');
    await f.workbench.deleteProject(projects[2].id);
    assert.equal(f.workbench.snapshot().activeProjectId, projects[0].id);
    await f.workbench.deleteProject(projects[0].id);
    assert.equal(f.workbench.snapshot().activeProjectId, null);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(storedProjects(reopened.snapshot()), []);
      const fresh = await reopened.createProject({ name: 'Fresh', directory: paths[1], total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
      assert.notEqual(fresh.project.id, projects[1].id); assert.equal(fresh.project.panels.length, 2);
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('restart reports each failed launch without falling back and a zero-panel project stays empty', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const settings = f.workbench.snapshot().settings;
    const { project } = await f.workbench.createProject({ name: 'Mixed', directory: f.directory, total: 2, counts: { codex: 1, claude: 1, pi: 0 } });
    settings.agents.claude.command = '/vibebridge-test/missing-agent';
    await f.workbench.saveSettings(settings);
    const result = await f.workbench.editProject(project.id, { name: 'Mixed moved', directory: target }, true);
    assert.deepEqual(result.launches.map(launch => launch.outcome), ['started', 'failed']);
    assert.deepEqual(result.launches.map(launch => launch.run.panelId), project.panels.map(panel => panel.id));
    assert.equal(f.workbench.snapshot().projects[0].directory, target);
    await until(() => f.output(result.launches[0].run.id).includes(`:${target}`));
    for (const panel of project.panels) await f.workbench.closePanel(project.id, panel.id);
    const empty = await f.workbench.editProject(project.id, { name: 'Empty', directory: f.directory }, true);
    assert.deepEqual(empty.project.panels, []); assert.equal(empty.project.layout, null); assert.deepEqual(empty.launches, []);
  } finally { await f.close(); }
});

test('failed saves do not mutate names or stop runs and failed deletion keeps all workbench records', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const f = await fixture();
  let database: InstanceType<typeof DatabaseSync> | undefined;
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.create('Keep');
    const run = runsOf(f.workbench.snapshot())[0];
    database = new DatabaseSync(join(f.directory, 'projects.sqlite'));
    database.exec('BEGIN IMMEDIATE'); // External filesystem/database fault, never a mocked collaborator.
    const unchanged = await f.workbench.editProject(project.id, { name: project.name, directory: project.directory }, false);
    assert.deepEqual(unchanged.project, project);
    await assert.rejects(f.workbench.editProject(project.id, { name: 'Unsaved', directory: target }, true), /projectStorageFailed/);
    assert.deepEqual(storedProjects(f.workbench.snapshot()), [project]);
    assert.deepEqual(runsOf(f.workbench.snapshot()), [run]);
    await assert.rejects(f.workbench.deleteProject(project.id), /projectStorageFailed/);
    assert.deepEqual(storedProjects(f.workbench.snapshot()), [project]);
    assert.equal(f.workbench.snapshot().activeProjectId, project.id);
    assert.equal(runsOf(f.workbench.snapshot())[0].state, 'stopped');
    assert.equal(alive(run.pid!), false);
    database.exec('ROLLBACK'); database.close(); database = undefined;
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try { assert.deepEqual(storedProjects(reopened.snapshot()), [project]); assert.equal(reopened.snapshot().activeProjectId, project.id); }
    finally { await reopened.quit(); }
  } finally { if (database) { database.exec('ROLLBACK'); database.close(); } await f.close(); }
});

test('a terminal stop timeout reports a saved edit and leaves panel records intact, including late controlled exit', async () => {
  const f = await fixture(); let host: number | undefined;
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.create('Stop failure');
    const run = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(run.id).includes('READY:'));
    await f.workbench.sendInput(run.id, 'host');
    await until(() => /HOST:(\d+)/.test(f.output(run.id)));
    host = Number(f.output(run.id).match(/HOST:(\d+)/)![1]);
    process.kill(host, 'SIGSTOP');
    const result = await f.workbench.editProject(project.id, { name: 'Saved with stop failure', directory: target }, true);
    assert.match(result.error!, /projectRestartFailed/);
    assert.deepEqual(result.launches, []);
    assert.equal(result.project.directory, target);
    assert.deepEqual(storedProjects(f.workbench.snapshot())[0].panels, project.panels);
    assert.equal(alive(run.pid!), true);
    process.kill(host, 'SIGCONT'); host = undefined;
    await until(() => !alive(run.pid!));
    await until(() => runsOf(f.workbench.snapshot())[0]?.state === 'stopped');
    assert.deepEqual(storedProjects(f.workbench.snapshot())[0].panels, project.panels);
  } finally { if (host) process.kill(host, 'SIGCONT'); await f.close(); }
});

test('deletion after a terminal manager failure does not claim cleanup succeeded or remove project records', async () => {
  const f = await fixture();
  try {
    const { project } = await f.create('Keep after failure');
    const run = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(run.id).includes('READY:'));
    await f.workbench.sendInput(run.id, 'host');
    await until(() => /HOST:(\d+)/.test(f.output(run.id)));
    const host = Number(f.output(run.id).match(/HOST:(\d+)/)![1]);
    process.kill(host, 'SIGKILL');
    await until(() => runsOf(f.workbench.snapshot())[0]?.state === 'stopped');
    await assert.rejects(f.workbench.deleteProject(project.id), /projectDeleteFailed.*terminalHostExited/);
    assert.deepEqual(storedProjects(f.workbench.snapshot()), [project]);
    await until(() => !alive(run.pid!));
  } finally { await f.close().catch(async () => { await rm(f.directory, { recursive: true, force: true }); }); }
});

test('a start response timeout returns an explicit per-panel uncertain result while retaining the saved directory', async () => {
  const f = await fixture(); let host: number | undefined; let paused = false;
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.create('Start timeout');
    const old = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(old.id).includes('READY:'));
    await f.workbench.sendInput(old.id, 'host');
    await until(() => /HOST:(\d+)/.test(f.output(old.id)));
    host = Number(f.output(old.id).match(/HOST:(\d+)/)![1]);
    const unsubscribe = f.workbench.subscribe(event => {
      if (!paused && event.kind === 'snapshot' && runsOf(event.snapshot).find(run => run.id === old.id)?.state === 'stopped') {
        paused = true; process.kill(host!, 'SIGSTOP');
      }
    });
    try {
      const result = await f.workbench.editProject(project.id, { name: 'Saved before start timeout', directory: target }, true);
      assert.equal(result.project.directory, target);
      assert.equal(result.launches.length, 1);
      const [launch] = result.launches;
      assert.equal(launch.outcome, 'unconfirmed');
      assert.match(launch.outcome === 'unconfirmed' ? launch.reason : '', /launchUnconfirmed.*terminalTimeout/);
      await assert.rejects(f.workbench.deleteProject(project.id), /projectDeleteFailed.*terminalTimeout/);
      assert.deepEqual(storedProjects(f.workbench.snapshot())[0].panels, project.panels);
    } finally { unsubscribe(); }
    process.kill(host, 'SIGCONT'); host = undefined;
    await until(() => runsOf(f.workbench.snapshot()).some(run => run.projectId === project.id && run.id !== old.id && run.state === 'stopped'));
    assert.deepEqual(storedProjects(f.workbench.snapshot())[0].panels, project.panels);
  } finally { if (host) process.kill(host, 'SIGCONT'); await f.close(); }
});
