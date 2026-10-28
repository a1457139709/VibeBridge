import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';
import type { WorkbenchEvent } from '../app/shared/model';
import { runsOf, storedProjects } from './support/panel-views';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal output');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('project creation rejects incomplete allocation and invalid directories without creating projects', async context => {
  const dataDirectory = await testDirectory(context, 'workbench-project-validation');
  const workbench = await Workbench.open(dataDirectory);
  try {
    const draft = { name: 'Example', directory: dataDirectory, total: 3, counts: { codex: 0, claude: 0, pi: 0 } };
    await assert.rejects(workbench.createProject(draft), /assignmentInvalid/);
    await assert.rejects(workbench.createProject({ ...draft, total: 1, counts: { codex: 1, claude: 0, pi: 0 }, directory: `${dataDirectory}/missing` }), /projectDirectoryInvalid|projectDuplicate/);
    await assert.rejects(workbench.createProject({ ...draft, name: ' ', total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /nameRequired|nameControls/);
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: '/no-such-test-agent', args: [] };
    await workbench.saveSettings(settings);
    for (const name of ['Manual\u001bname', 'Manual\nname', 'Manual\u2028name']) {
      await assert.rejects(workbench.createProject({ ...draft, name, total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /nameControls/);
    }
    assert.deepEqual(storedProjects(workbench.snapshot()), []);
    assert.deepEqual(runsOf(workbench.snapshot()), []);
  } finally {
    await workbench.quit();
  }
});

test('confirmed projects start independent runs in the selected directory and reject stale input', async context => {
  const dataDirectory = await testDirectory(context, 'workbench-input-routing');
  const workbench = await Workbench.open(dataDirectory);
  const events: WorkbenchEvent[] = [];
  const unsubscribe = workbench.subscribe(event => events.push(event));
  try {
    const settings = workbench.snapshot().settings;
    for (const type of ['codex', 'claude', 'pi'] as const) settings.agents[type] = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Three agents', directory: dataDirectory, total: 3, counts: { codex: 1, claude: 1, pi: 1 } });
    assert.deepEqual(project.panels.map(p => p.agent), ['codex', 'claude', 'pi']);
    const runs = runsOf(workbench.snapshot());
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
    await assert.rejects(workbench.createProject({ name: 'Duplicate', directory: dataDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } }), /projectDirectoryExists/);
    await workbench.sendInput(runs[1].id, 'exit');
    await until(() => workbench.snapshot().projects[0].panels.length === 2);
    await assert.rejects(workbench.sendInput(runs[1].id, 'stale'), /runInvalid/);
  } finally {
    unsubscribe();
    await workbench.quit();
  }
});

test('quit cleans up runs and detached children while preserving the saved workspace for new runs', async context => {
  const dataDirectory = await testDirectory(context, 'workbench-quit');
  let workbench = await Workbench.open(dataDirectory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const events: WorkbenchEvent[] = [];
    workbench.subscribe(event => events.push(event));
    const { project } = await workbench.createProject({ name: 'Persistent', directory: dataDirectory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const oldRuns = runsOf(workbench.snapshot());
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
    assert.deepEqual(storedProjects(workbench.snapshot())[0].panels, project.panels);
    assert.deepEqual(workbench.snapshot().settings, settings);
    await workbench.activateProject(project.id);
    assert.ok(runsOf(workbench.snapshot()).every(r => !oldRuns.some(old => old.id === r.id)));
    await assert.rejects(workbench.sendInput(oldRuns[0].id, 'old-run'), /runInvalid/);
    await workbench.closePanel(project.id, project.panels[0].id);
    await workbench.quit();
    workbench = await Workbench.open(dataDirectory);
    assert.deepEqual(workbench.snapshot().projects[0].panels.map(p => p.id), [project.panels[1].id]);
  } finally {
    await workbench.quit();
  }
});

test('shared panel operations enforce the limit and report launch failure without substituting another Agent', async context => {
  const dataDirectory = await testDirectory(context, 'workbench-panel-limit');
  const workbench = await Workbench.open(dataDirectory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.pi = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project, launches } = await workbench.createProject({ name: 'Limit', directory: dataDirectory, total: 10, counts: { codex: 0, claude: 0, pi: 10 } });
    assert.equal(launches.length, 10);
    assert.ok(launches.every(launch => launch.outcome === 'started'));
    await assert.rejects(workbench.addPanel(project.id, 'codex'), /panelLimit/);
    await workbench.closePanel(project.id, project.panels[0].id);
    const additions = await Promise.allSettled([workbench.addPanel(project.id, 'pi'), workbench.addPanel(project.id, 'pi')]);
    assert.equal(additions.filter(result => result.status === 'fulfilled').length, 1);
    const rejected = additions.find(result => result.status === 'rejected');
    assert.ok(rejected?.status === 'rejected');
    assert.match(rejected.reason.message, /panelLimit/);
    assert.equal(workbench.snapshot().projects[0].panels.length, 10);
    await workbench.saveSettings({ agents: { ...settings.agents, codex: { command: '/no-such-agent', args: [] } } });
    await workbench.closePanel(project.id, project.panels[1].id);
    const failed = await workbench.addPanel(project.id, 'codex');
    assert.equal(failed.launch.outcome, 'failed');
    assert.equal(failed.panel.agent, 'codex');
    assert.deepEqual(workbench.snapshot().projects[0].panels.map(panel => panel.agent), Array(9).fill('pi'));
  } finally { await workbench.quit(); }
});

test('damaged configuration is reported and preserved instead of being overwritten on quit', async context => {
  const directory = await testDirectory(context, 'workbench-damaged-settings');
  const damaged = '{ accidentally truncated';
  await writeFile(`${directory}/settings.json`, damaged);
  const workbench = await Workbench.open(directory);
  try {
    assert.match(workbench.snapshot().errors.join('\n'), /settingsReadFailed/);
    assert.deepEqual(await workbench.saveSettings(workbench.snapshot().settings), { ok: false, kind: 'storage', message: message('settingsUnreadable') });
    await assert.rejects(workbench.quit(), /settingsUnreadable/);
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), damaged);
  } finally { await workbench.quit().catch(() => {}); }
});

test('a project database read failure does not overwrite the existing user configuration', async context => {
  const directory = await testDirectory(context, 'workbench-damaged-storage');
  const settings = '{ "theme": "dark", "agents": { "codex": { "command": "custom-codex", "args": [] }, "claude": { "command": "claude", "args": [] }, "pi": { "command": "pi", "args": [] } } }';
  await writeFile(`${directory}/settings.json`, settings);
  await writeFile(`${directory}/projects.sqlite`, 'damaged database');
  await assert.rejects(Workbench.open(directory));
  assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), settings);
});
