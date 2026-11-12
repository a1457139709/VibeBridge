const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

const rect = (evaluate, selector) => evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return box && { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }; })()`);

module.exports = {
  async run(base) {
    await require('./support/project.cjs')(base, 'Sidebar project', { Codex: 1 });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, reportedSize } = context;
    const [run] = runsOf(await evaluate('window.workbench.snapshot()'));
    const drawnRows = () => evaluate('document.querySelector(".xterm-rows").children.length');
    let initial;
    await until(async () => (initial = await reportedSize(run.id)).rows === await drawnRows(), 'run reports the rows the terminal shows');
    const canvas = await rect(evaluate, '.canvas');

    // Overlay: the sidebar lies over the layout area, which still reaches the window's right edge; the toolbar and tray make room.
    // That the PTY then keeps its size is a "does not happen" claim the desktop suite cannot prove (ADR 0005): the PTY follows the
    // terminal's box, and this geometry leaves that box where it was.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })')).ok);
    await click('Show the GitHub sidebar');
    await until(async () => (await rect(evaluate, '.forge-sidebar'))?.width === 380, 'overlaying sidebar drawn 380px wide');
    const sidebar = await rect(evaluate, '.forge-sidebar');
    assert.equal((await rect(evaluate, '.app-body > main')).right, (await rect(evaluate, '.app-body')).right, 'the layout area reaches under the sidebar to the window edge');
    assert.ok(sidebar.left < canvas.right, 'the sidebar covers the layout area');
    assert.ok((await rect(evaluate, '.workspace-toolbar > button')).right <= sidebar.left, 'the toolbar makes room for the sidebar');
    const trayContentRight = await evaluate(`(() => { const tray = document.querySelector('.panel-tray');
      return tray.getBoundingClientRect().right - parseFloat(getComputedStyle(tray).paddingRight); })()`);
    assert.ok(trayContentRight <= sidebar.left, 'the tray makes room for the sidebar');
    await click('Hide the GitHub sidebar');
    await until(async () => !(await rect(evaluate, '.forge-sidebar')), 'sidebar closed');

    // Squeeze: the layout area ends where the sidebar begins, and the terminal and its PTY follow.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "squeeze" })')).ok);
    await click('Show the GitHub sidebar');
    await until(async () => (await rect(evaluate, '.app-body > main'))?.right === (await rect(evaluate, '.forge-sidebar'))?.left, 'squeezing sidebar ends the layout area at its left edge');
    await until(async () => (await reportedSize(run.id)).cols < initial.cols, 'squeezing the layout area resizes the PTY to fewer columns');

    // Dragging the left edge 70px to the left widens the sidebar from 380px to 450px and saves it.
    const dragging = require('./support/dragging.cjs')(context);
    const edge = dragging.center(await dragging.rect('.forge-sidebar-resize'));
    context.window.webContents.sendInputEvent({ type: 'mouseDown', ...edge, button: 'left', modifiers: ['leftbuttondown'], clickCount: 1 });
    context.window.webContents.sendInputEvent({ type: 'mouseMove', x: edge.x - 70, y: edge.y, button: 'left', modifiers: ['leftbuttondown'] });
    context.window.webContents.sendInputEvent({ type: 'mouseUp', x: edge.x - 70, y: edge.y, button: 'left', clickCount: 1 });
    await until(async () => (await evaluate('window.workbench.snapshot()')).forgeSidebar.width === 450, 'dragging the left edge saved a 450px width');
    await until(async () => (await rect(evaluate, '.forge-sidebar'))?.width === 450, 'sidebar drawn at its dragged 450px width');
    console.log('Overlay lay over the layout area while the toolbar made room; squeeze ended the layout area at the sidebar and resized the PTY.');
  },
  async reopen({ evaluate, until }) {
    await until(async () => (await evaluate(`document.querySelector('.forge-sidebar')?.getBoundingClientRect().width`)) === 450, 'reopened sidebar drawn open at 450px');
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).forgeSidebar, { visible: true, width: 450 });
    assert.equal(await evaluate(`document.querySelector('.forge-sidebar-toggle').getAttribute('aria-expanded')`), 'true');
    console.log('Reopening restored the open sidebar and its width.');
  },
};
