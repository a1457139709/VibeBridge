import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { WorkbenchEvent } from '../app/shared/model';

test.before(async () => { await mkdir('work/issue-24', { recursive: true }); });

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal output');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('project creation rejects incomplete allocation and invalid directories without creating projects', async () => {
  const dataDirectory = await mkdtemp(resolve('work/issue-24/check-'));
  const workbench = await Workbench.open(dataDirectory);
  try {
    const draft = { name: 'Example', directory: dataDirectory, total: 3, counts: { codex: 0, claude: 0, pi: 0 } };
    await assert.rejects(workbench.createProject(draft), /分配/);
    await assert.rejects(workbench.createProject({ ...draft, total: 1, counts: { codex: 1, claude: 0, pi: 0 }, directory: `${dataDirectory}/missing` }), /目录/);
    await assert.rejects(workbench.createProject({ ...draft, name: ' ', total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /名称/);
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: '/no-such-test-agent', args: [] };
    await workbench.saveSettings(settings);
    for (const name of ['Manual\u001bname', 'Manual\nname', 'Manual\u2028name']) {
      await assert.rejects(workbench.createProject({ ...draft, name, total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /控制字符/);
    }
    assert.deepEqual(workbench.snapshot().projects, []);
    assert.deepEqual(workbench.snapshot().runs, []);
  } finally {
    await workbench.quit();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('confirmed projects start independent runs in the selected directory and reject stale input', async () => {
  const dataDirectory = await mkdtemp(resolve('work/issue-24/check-'));
  const workbench = await Workbench.open(dataDirectory);
  const events: WorkbenchEvent[] = [];
  const unsubscribe = workbench.subscribe(event => events.push(event));
  try {
    const settings = workbench.snapshot().settings;
    for (const type of ['codex', 'claude', 'pi'] as const) settings.agents[type] = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Three agents', directory: dataDirectory, total: 3, counts: { codex: 1, claude: 1, pi: 1 } });
    assert.deepEqual(project.panels.map(p => p.agent), ['codex', 'claude', 'pi']);
    const runs = workbench.snapshot().runs;
    assert.equal(runs.length, 3);
    assert.equal(new Set(runs.map(r => r.id)).size, 3);
    const output = (runId: string) => events.filter(e => e.kind === 'output' && e.runId === runId).map(e => e.kind === 'output' ? e.data : '').join('');
    await until(() => runs.every(run => output(run.id).includes(`:${dataDirectory}`)));
    await workbench.sendInput(runs[1].id, 'unique-target');
    await until(() => output(runs[1].id).includes('INPUT:unique-target'));
    assert.ok(!output(runs[0].id).includes('unique-target'));
    assert.ok(!output(runs[2].id).includes('unique-target'));
    await workbench.resizeRun(runs[1].id, 93, 27);
    await until(() => output(runs[1].id).includes('SIZE:93x27'));
    assert.equal((await workbench.inspectDirectory(`${dataDirectory}/.`)).existingProjectId, project.id);
    await assert.rejects(workbench.createProject({ name: 'Duplicate', directory: dataDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /已有项目/);
    await workbench.sendInput(runs[1].id, 'exit');
    await until(() => workbench.snapshot().projects[0].panels.length === 2);
    await assert.rejects(workbench.sendInput(runs[1].id, 'stale'), /运行已失效/);
  } finally {
    unsubscribe();
    await workbench.quit();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('quit cleans up runs and detached children while preserving the saved workspace for new runs', async () => {
  const dataDirectory = await mkdtemp(resolve('work/issue-24/check-'));
  let workbench = await Workbench.open(dataDirectory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const events: WorkbenchEvent[] = [];
    workbench.subscribe(event => events.push(event));
    const { project } = await workbench.createProject({ name: 'Persistent', directory: dataDirectory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const oldRuns = workbench.snapshot().runs;
    await until(() => events.some(e => e.kind === 'output' && e.data.includes('READY:')));
    await workbench.sendInput(oldRuns[0].id, 'child');
    let childPid = 0;
    await until(() => {
      const output = events.filter(e => e.kind === 'output').map(e => e.kind === 'output' ? e.data : '').join('');
      childPid = Number(output.match(/CHILD:(\d+)/)?.[1]);
      return !!childPid;
    });
    const layout = { axis: 'row' as const, ratio: 0.7, first: { panel: project.panels[1].id }, second: { panel: project.panels[0].id } };
    const saving = workbench.saveLayout(project.id, layout);
    const quitStarted = Date.now();
    await workbench.quit();
    await saving;
    assert.ok(Date.now() - quitStarted < 1800, 'cooperative runs should not wait for the two-second force deadline');
    for (const pid of [...oldRuns.map(r => r.pid!), childPid]) assert.throws(() => process.kill(pid, 0));
    workbench = await Workbench.open(dataDirectory);
    assert.equal(workbench.snapshot().activeProjectId, project.id);
    assert.deepEqual(workbench.snapshot().projects[0].layout, layout);
    assert.deepEqual(workbench.snapshot().projects[0].panels, project.panels);
    assert.deepEqual(workbench.snapshot().settings, settings);
    await workbench.activateProject(project.id);
    assert.ok(workbench.snapshot().runs.every(r => !oldRuns.some(old => old.id === r.id)));
    await assert.rejects(workbench.sendInput(oldRuns[0].id, 'old-run'), /运行已失效/);
    await workbench.closePanel(project.id, project.panels[0].id);
    await workbench.quit();
    workbench = await Workbench.open(dataDirectory);
    assert.deepEqual(workbench.snapshot().projects[0].panels.map(p => p.id), [project.panels[1].id]);
  } finally {
    await workbench.quit();
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

test('shared panel operations enforce the limit and report launch failure without substituting another Agent', async () => {
  const dataDirectory = await mkdtemp(resolve('work/issue-24/check-'));
  const workbench = await Workbench.open(dataDirectory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.pi = { command: '/no-such-agent', args: [] };
    await workbench.saveSettings(settings);
    const { project, launches } = await workbench.createProject({ name: 'Limit', directory: dataDirectory, total: 10, counts: { codex: 0, claude: 0, pi: 10 } });
    assert.equal(launches.length, 10);
    assert.ok(launches.every(launch => !launch.ok && launch.error === 'Agent 无法启动'));
    assert.ok(workbench.snapshot().runs.every(run => run.state === 'failed'));
    assert.ok(workbench.snapshot().projects[0].panels.every(panel => panel.agent === 'pi'));
    await assert.rejects(workbench.addPanel(project.id, 'codex'), /最多 10/);
    await workbench.closePanel(project.id, project.panels[0].id);
    const additions = await Promise.allSettled([workbench.addPanel(project.id, 'pi'), workbench.addPanel(project.id, 'pi')]);
    assert.equal(additions.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = additions.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.match(rejected.reason.message, /最多 10/);
    assert.equal(workbench.snapshot().projects[0].panels.length, 10);
  } finally { await workbench.quit(); await rm(dataDirectory, { recursive: true, force: true }); }
});

test('damaged configuration is reported and preserved instead of being overwritten on quit', async () => {
  const directory = await mkdtemp(resolve('work/issue-24/check-'));
  const damaged = '{ accidentally truncated';
  await writeFile(`${directory}/settings.json`, damaged);
  const workbench = await Workbench.open(directory);
  try {
    assert.match(workbench.snapshot().errors.join('\n'), /配置读取失败/);
    assert.deepEqual(await workbench.saveSettings(workbench.snapshot().settings), { ok: false, kind: 'storage', message: '配置读取失败，未覆盖原配置；请修正后重新启动' });
    await assert.rejects(workbench.quit(), /未覆盖原配置/);
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), damaged);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a project database read failure does not overwrite the existing user configuration', async () => {
  const directory = await mkdtemp(resolve('work/issue-24/check-'));
  const settings = '{ "theme": "dark", "agents": { "codex": { "command": "custom-codex", "args": [] }, "claude": { "command": "claude", "args": [] }, "pi": { "command": "pi", "args": [] } } }';
  await writeFile(`${directory}/settings.json`, settings);
  await writeFile(`${directory}/projects.sqlite`, 'damaged database');
  try {
    await assert.rejects(Workbench.open(directory));
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), settings);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
