import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { WorkbenchEvent } from '../app/shared/model';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for project output');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('projects share a terminal host while retaining independent runs, background output and input targets', async () => {
  const directory = await mkdtemp(resolve('work/projects-'));
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => events.push(event));
  const output = (id: string) => events.filter(event => event.kind === 'output' && event.runId === id)
    .map(event => event.kind === 'output' ? event.data : '').join('');
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const secondDirectory = resolve(directory, 'second');
    await mkdir(secondDirectory);
    const create = (name: string, path: string) => workbench.createProject({ name, directory: path, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const { project: first } = await create('First', directory);
    const { project: second } = await create('Second', secondDirectory);
    const runs = workbench.snapshot().runs;
    const firstRun = runs.find(run => run.projectId === first.id)!;
    const secondRun = runs.find(run => run.projectId === second.id)!;
    assert.notEqual(firstRun.id, secondRun.id);
    assert.notEqual(firstRun.panelId, secondRun.panelId);
    await until(() => output(firstRun.id).includes(`:${directory}`) && output(secondRun.id).includes(`:${secondDirectory}`));
    for (const run of runs) await workbench.sendInput(run.id, 'host');
    await until(() => runs.every(run => /HOST:(\d+)/.test(output(run.id))));
    assert.equal(output(firstRun.id).match(/HOST:(\d+)/)![1], output(secondRun.id).match(/HOST:(\d+)/)![1]);
    await workbench.activateProject(first.id);
    await workbench.sendInput(firstRun.id, 'later');
    await workbench.activateProject(second.id);
    await until(() => output(firstRun.id).includes('BACKGROUND:completed'));
    await workbench.sendInput(secondRun.id, 'second-only');
    await until(() => output(secondRun.id).includes('INPUT:second-only'));
    assert.ok(!output(firstRun.id).includes('second-only'));
    await Promise.all([workbench.activateProject(first.id), workbench.activateProject(second.id), workbench.activateProject(first.id)]);
    assert.deepEqual(workbench.snapshot().runs, runs);
    await workbench.activateProject(second.id);
    await workbench.closePanel(first.id, first.panels[0].id);
    assert.deepEqual(workbench.snapshot().projects.find(project => project.id === first.id)?.panels, []);
    assert.throws(() => process.kill(firstRun.pid!, 0));
    await workbench.sendInput(secondRun.id, 'still-running');
    await until(() => output(secondRun.id).includes('INPUT:still-running'));
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});
