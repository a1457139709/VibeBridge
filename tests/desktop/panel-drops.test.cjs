const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { runsOf } = require('./support/panel-views.cjs');
const dragging = require('./support/dragging.cjs');

module.exports = {
  async run(context) {
    const { window, evaluate, until, click, directory } = context;
    const { rect, geometry, press: pressOn, hover, release, previewBox } = dragging(context);
    await require('./support/project.cjs')(context, 'First project');
    const projectDirectory = `${directory}/drops`; await mkdir(projectDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Drop project', directory: projectDirectory, total: 3, counts: { codex: 1, claude: 1, pi: 1 } })})`);
    await click('Drop project');
    const project = () => evaluate('window.workbench.snapshot()').then(snapshot => snapshot.projects.find(project => project.name === 'Drop project'));
    await until(async () => (await project()).panels.every(panel => panel.run?.state === 'running'), 'every Drop project run running');
    const created = await project();
    const [a, b, c] = created.panels.map(panel => panel.id);
    const runs = runsOf({ projects: [created] }).map(run => run.id).sort();
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(created.id)}, ${JSON.stringify({ axis: 'row', ratio: .5, first: { panel: a },
      second: { axis: 'column', ratio: .5, first: { panel: b }, second: { panel: c } } })})`);
    const settle = async expected => {
      await until(async () => JSON.stringify(await geometry([a, b, c])) === JSON.stringify(expected), `panel geometry settles at ${JSON.stringify(expected)}`);
      assert.deepEqual(runsOf({ projects: [await project()] }).map(run => run.id).sort(), runs);
    };
    await settle({ [a]: [0, 0, .5, 1], [b]: [.5, 0, .5, .5], [c]: [.5, .5, .5, .5] });
    const press = id => pressOn(`[data-panel-id="${id}"] .panel-header`);

    // Edge: the dragged panel fills the bottom of the layout area, so two panels stack top and bottom.
    // While a resident panel is dragged, the empty tray's drop target covers the bottom of the layout
    // area, so the layout's bottom edge sits just above the tray.
    await press(a);
    const canvas = await rect('.canvas'), tray = await rect('.panel-tray');
    let point = { x: Math.round(canvas.left + canvas.width / 4), y: Math.round(tray.top - 8) };
    await hover(point, 'Drop preview: Codex along the bottom of the layout area');
    assert.deepEqual(await previewBox(), [0, .5, 1, .5]);
    release(point);
    await settle({ [a]: [0, .5, 1, .5], [b]: [0, 0, 1, .25], [c]: [0, .25, 1, .25] });

    // Perimeter: outside the middle third, the target splits on the side nearest the pointer.
    let target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width * .1), y: Math.round(target.top + target.height / 2) };
    await press(c); await hover(point, 'Drop preview: pi on the left of Codex');
    assert.deepEqual(await previewBox(), [0, .5, .5, .5]);
    release(point);
    await settle({ [a]: [.5, .5, .5, .5], [b]: [0, 0, 1, .5], [c]: [0, .5, .5, .5] });

    // Middle: the middle third swaps with the target.
    target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(b); await hover(point, 'Swap preview: Claude Code and Codex');
    release(point);
    const final = { [a]: [0, 0, 1, .5], [b]: [.5, .5, .5, .5], [c]: [0, .5, .5, .5] };
    await settle(final);
    const saved = (await project()).layout;

    // Esc cancels a drag over a valid drop; releasing over the dragged panel itself is not a drop.
    target = await rect(`[data-panel-id="${c}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(a); await hover(point, 'Swap preview: Codex and pi');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(() => evaluate('!document.querySelector(".canvas").classList.contains("dragging") && !document.querySelector(".panel-swap-preview")'), 'Esc ended the drag and removed the swap preview');
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    release(point);
    target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(a);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left', modifiers: ['leftbuttondown'] });
    release(point);
    await until(() => evaluate('!document.querySelector(".canvas").classList.contains("dragging")'), 'release over the dragged panel ended the drag');
    await settle(final);
    await writeFile(`${directory}/expected.json`, JSON.stringify({ ids: [a, b, c], layout: saved, geometry: final }));
    console.log('Edge, perimeter and middle drops rearranged resident panels with their runs intact; Esc and an invalid release changed nothing.');
  },
  async reopen(context) {
    const { evaluate, until, directory } = context;
    const { geometry } = dragging(context);
    const { ids, layout, geometry: expected } = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
    const project = (await evaluate('window.workbench.snapshot()')).projects.find(project => project.name === 'Drop project');
    assert.deepEqual(project.layout, layout);
    await until(async () => JSON.stringify(await geometry(ids)) === JSON.stringify(expected), `reopened layout draws ${JSON.stringify(expected)}`);
    console.log('Reopening restored the rearranged layout.');
  },
};
