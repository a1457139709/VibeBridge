const assert = require('node:assert/strict');
const { panelViews } = require('./support/panel-views.cjs');
const dragging = require('./support/dragging.cjs');

module.exports = {
  async run(context) {
    const { evaluate, until } = context;
    const { rect, center, geometry, press, hover, release } = dragging(context);
    const created = await require('./support/project.cjs')(context, 'Empty tray', { Codex: 2 });
    const [a, b] = created.projects[0].panels.map(panel => panel.id);
    const project = async () => (await evaluate('window.workbench.snapshot()')).projects[0];
    await until(async () => panelViews({ projects: [await project()] }).every(panel => panel.run?.state === 'running'), 'every Empty tray run running');
    const runs = Object.fromEntries(panelViews({ projects: [await project()] }).map(panel => [panel.id, panel.run.id]));
    const tray = async () => (await project()).tray.map(panel => panel.id);
    const settle = async (expectedTray, layout) => {
      await until(async () => JSON.stringify(await tray()) === JSON.stringify(expectedTray), `tray holds ${JSON.stringify(expectedTray)}`);
      await until(async () => JSON.stringify(await geometry(Object.keys(layout))) === JSON.stringify(layout), `panel geometry settles at ${JSON.stringify(layout)}`);
      assert.deepEqual(Object.fromEntries(panelViews({ projects: [await project()] }).map(panel => [panel.id, panel.run.id])), runs);
    };
    const border = (selector, side) => evaluate(`(() => { const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)}));
      return style.border${side}Width + ' ' + style.border${side}Style; })()`);
    const trayShown = () => evaluate('getComputedStyle(document.querySelector(".panel-tray")).visibility === "visible"');
    const workspace = await rect('.workspace');
    await settle([], { [a]: [0, 0, .5, 1], [b]: [.5, 0, .5, 1] });

    // With no ephemeral panels the tray takes no space: the layout area reaches the workspace bottom.
    assert.equal(await border('.workspace-toolbar', 'Bottom'), '1px solid', 'a line separates the toolbar from the layout area');
    assert.equal(await trayShown(), false);
    assert.ok(workspace.bottom - (await rect('.canvas')).bottom <= 4, 'the layout area reaches the bottom of the workspace');

    // Dragging a resident panel shows the empty tray as a drop target along the bottom, over the layout area.
    await press(`[data-panel-id="${a}"] .panel-header`);
    assert.equal(await trayShown(), true);
    const strip = await rect('.panel-tray');
    assert.equal(Math.round(strip.bottom), Math.round(workspace.bottom));
    assert.equal(await border('.panel-tray', 'Top'), '1px solid', 'a line separates the tray from the layout area');
    // The bottom edge band sits just above the tray and still fills the bottom of the layout area.
    const canvas = await rect('.canvas');
    await hover({ x: Math.round(canvas.left + canvas.width / 4), y: Math.round(strip.top - 8) }, 'Drop preview: Codex along the bottom of the layout area');
    const point = center(strip);
    await hover(point, 'Drop preview: Codex moves to the tray');

    // Cancelling the drag hides the empty tray again and changes nothing.
    context.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(() => evaluate('!document.querySelector(".canvas").classList.contains("dragging")'), 'Esc ended the drag');
    context.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    release(point);
    await until(async () => !(await trayShown()), 'empty tray hidden after the cancelled drag');
    await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
    await settle([], { [a]: [0, 0, .5, 1], [b]: [.5, 0, .5, 1] });

    // Dropping the header on the empty tray makes the panel ephemeral; the tray then stays below the layout area.
    await press(`[data-panel-id="${a}"] .panel-header`);
    await hover(point, 'Drop preview: Codex moves to the tray');
    release(point);
    await settle([a], { [b]: [0, 0, 1, 1] });
    assert.equal(await trayShown(), true, 'a tray holding a panel stays shown');
    assert.ok((await rect('.canvas')).bottom <= (await rect('.panel-tray')).top, 'a tray holding a panel sits below the layout area');

    // The move-to-tray action does the same as dropping the header on the tray, and leaves the panel collapsed.
    await evaluate(`document.querySelector('[data-panel-id="${b}"] .panel-actions button[aria-label="Move to tray"]').click()`);
    await until(async () => JSON.stringify(await tray()) === JSON.stringify([a, b]), 'move-to-tray action put both panels in the tray');
    assert.equal((await project()).layout, null);
    assert.deepEqual(Object.fromEntries(panelViews({ projects: [await project()] }).map(panel => [panel.id, panel.run.id])), runs);
    assert.equal(await evaluate('document.querySelector(".tray-card[aria-pressed=true]")'), null, 'the moved panel is not open');
    console.log('The empty tray took no space and appeared only while a resident panel was dragged; lines separated the toolbar, layout area and tray; the move-to-tray action matched the drop and kept every run.');
  },
};
