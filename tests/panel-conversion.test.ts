import test from 'node:test';
import assert from 'node:assert/strict';
import { Workbench } from '../app/main/workbench';
import type { Layout } from '../app/shared/model';
import { storedProjects } from './support/panel-views';
import { interactiveWorkbench, until } from './support/interactive-workbench';

const fixture = () => interactiveWorkbench('panel-conversion');

test('placing a tray panel into the layout and moving a resident panel to the tray keep their runs', async () => {
  const f = await fixture();
  try {
    const { project } = await f.create('Conversion', f.directory, 2);
    const [left, right] = project.panels;
    const added = await f.workbench.addPanel(project.id, 'codex');
    const run = added.launch.run;
    await until(() => f.output(run.id).includes('READY:'));
    const layout: Layout = { axis: 'row', ratio: .5, first: { panel: left.id }, second: { axis: 'column', ratio: .5, first: { panel: right.id }, second: { panel: added.panel.id } } };
    await f.workbench.placeInLayout(project.id, added.panel.id, layout);
    let view = f.workbench.snapshot().projects[0];
    assert.deepEqual(view.layout, layout);
    assert.deepEqual(view.tray, []);
    assert.equal(view.panels.find(panel => panel.id === added.panel.id)?.run?.id, run.id);
    await f.workbench.sendInput(run.id, 'placed');
    await until(() => f.output(run.id).includes('INPUT:placed'));

    const residentRun = view.panels.find(panel => panel.id === left.id)!.run!;
    await f.workbench.moveToTray(project.id, left.id);
    view = f.workbench.snapshot().projects[0];
    assert.deepEqual(view.layout, { axis: 'column', ratio: .5, first: { panel: right.id }, second: { panel: added.panel.id } }, 'the remaining resident panels fill the space as when a panel closes');
    assert.deepEqual(view.tray.map(panel => [panel.id, panel.run?.id]), [[left.id, residentRun.id]]);
    await f.workbench.sendInput(residentRun.id, 'moved');
    await until(() => f.output(residentRun.id).includes('INPUT:moved'));
  } finally { await f.close(); }
});

test('placing into the layout rejects a wrong target layout without changing anything, and a swap moves the replaced panel to the tray', async () => {
  const f = await fixture();
  try {
    const { project } = await f.create('Swap', f.directory, 2);
    const [left, right] = project.panels;
    const first = await f.workbench.addPanel(project.id, 'codex');
    const second = await f.workbench.addPanel(project.id, 'codex');
    const before = f.workbench.snapshot();
    const wrong: Layout[] = [
      { axis: 'row', ratio: .5, first: { panel: left.id }, second: { panel: right.id } },
      { axis: 'row', ratio: .5, first: { panel: first.panel.id }, second: { panel: second.panel.id } },
      { panel: first.panel.id },
    ];
    for (const layout of wrong) await assert.rejects(f.workbench.placeInLayout(project.id, first.panel.id, layout), /layoutMismatch/);
    await assert.rejects(f.workbench.placeInLayout(project.id, left.id, { axis: 'row', ratio: .5, first: { panel: left.id }, second: { panel: right.id } }), /panelMissing/);
    assert.deepEqual(f.workbench.snapshot(), before);

    const swapped: Layout = { axis: 'row', ratio: .5, first: { panel: first.panel.id }, second: { panel: right.id } };
    await f.workbench.placeInLayout(project.id, first.panel.id, swapped);
    const view = f.workbench.snapshot().projects[0];
    assert.deepEqual(view.layout, swapped);
    assert.deepEqual(view.panels.map(panel => panel.id).sort(), [first.panel.id, right.id].sort());
    assert.deepEqual(view.tray.map(panel => panel.id), [second.panel.id, left.id], 'the replaced panel joins the end of the tray');
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try { assert.deepEqual(storedProjects(reopened.snapshot())[0].layout, swapped); }
    finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('a resident panel moved to the tray does not return when the application reopens', async () => {
  const f = await fixture();
  try {
    const { project } = await f.create('Reopen', f.directory, 2);
    const [left, right] = project.panels;
    await f.workbench.moveToTray(project.id, left.id);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      const restored = reopened.snapshot().projects[0];
      assert.deepEqual(restored.panels.map(panel => panel.id), [right.id]);
      assert.deepEqual(restored.layout, { panel: right.id });
      assert.deepEqual(restored.tray, []);
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});
