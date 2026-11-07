import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runsOf } from './support/panel-views';
import { alive, interactiveWorkbench, until } from './support/interactive-workbench';

const fixture = () => interactiveWorkbench('tray-panels');

test('directory restart restarts resident panels while tray panels keep their run in the original directory', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.create('Mixed', f.directory, 1);
    const resident = runsOf(f.workbench.snapshot())[0];
    const added = await f.workbench.addPanel(project.id, 'codex');
    const tray = added.launch.run;
    await until(() => f.output(tray.id).includes('READY:'));
    const result = await f.workbench.editProject(project.id, { name: 'Mixed moved', directory: target }, true);
    assert.equal(result.error, undefined);
    assert.deepEqual(result.launches.map(launch => launch.run.panelId), [project.panels[0].id]);
    assert.notEqual(result.launches[0].run.id, resident.id);
    assert.equal(alive(resident.pid!), false);
    const view = f.workbench.snapshot().projects[0];
    assert.deepEqual(view.tray.map(panel => [panel.id, panel.run?.id, panel.run?.state]), [[added.panel.id, tray.id, 'running']]);
    await f.workbench.sendInput(tray.id, 'cwd-report');
    await until(() => f.output(tray.id).includes(`CWD:${f.directory}`));
  } finally { await f.close(); }
});

test('deleting a project and quitting the Workbench both end tray panel runs', async () => {
  const f = await fixture();
  try {
    const second = join(f.directory, 'second'); await mkdir(second);
    const { project } = await f.create('Deleted');
    const deleted = (await f.workbench.addPanel(project.id, 'codex')).launch.run;
    const { project: kept } = await f.create('Kept', second);
    const quitting = (await f.workbench.addPanel(kept.id, 'codex')).launch.run;
    await until(() => [deleted, quitting].every(run => f.output(run.id).includes('READY:')));
    await f.workbench.sendInput(deleted.id, 'orphan');
    await until(() => /ORPHAN:(\d+)/.test(f.output(deleted.id)));
    const orphan = Number(f.output(deleted.id).match(/ORPHAN:(\d+)/)![1]);
    await f.workbench.deleteProject(project.id);
    assert.equal(alive(deleted.pid!), false); assert.equal(alive(orphan), false);
    await assert.rejects(f.workbench.sendInput(deleted.id, 'stale'), /runInvalid/);
    assert.deepEqual(f.workbench.snapshot().projects.map(item => item.id), [kept.id]);
    await f.workbench.quit();
    assert.equal(alive(quitting.pid!), false);
  } finally { await f.close(); }
});
