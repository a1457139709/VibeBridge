const assert = require('node:assert/strict');

// The run's answer to a size query: the PTY size the run has now, as COLUMNSxROWS.
async function runSize({ evaluate, until }, runId) {
  await evaluate(`window.output = ''; window.workbench.sendInput(${JSON.stringify(runId)}, 'size')`);
  await until(() => evaluate('/SIZE:\\d+x\\d+\\r/.test(window.output)'), 'run answered the size query');
  return evaluate('window.output.match(/SIZE:(\\d+x\\d+)\\r/)[1]');
}

const box = (evaluate, selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return r && { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; })()`);

module.exports = {
  async run(base) {
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, window } = context;
    window.setContentSize(1280, 800);
    await until(() => evaluate('document.documentElement.clientWidth === 1280'), 'window content is 1280px wide');
    const created = await require('./support/project.cjs')(context, 'Sidebar project', { Codex: 1 });
    const [panel] = created.projects[0].panels;
    const runId = created.projects[0].panels[0].run.id;
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'), 'terminal shows READY:');
    const closedCanvas = await box(evaluate, '.canvas');
    const closedSize = await runSize(context, runId);

    // Overlay: the sidebar lies over the layout area, the toolbar and tray yield, and the PTY keeps its size.
    await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })');
    await until(async () => (await evaluate('window.workbench.snapshot()')).settings.sidebarCoexistence === 'overlay', 'overlay saved');
    await click('Open issue sidebar');
    await until(() => evaluate('document.querySelector(".app-body").classList.contains("issue-sidebar-overlay") && !!document.querySelector(".issue-sidebar")'), 'sidebar open over the layout area');
    let geometry;
    await until(async () => {
      geometry = { sidebar: await box(evaluate, '.issue-sidebar'), toolbar: await box(evaluate, '.workspace-toolbar'), canvas: await box(evaluate, '.canvas') };
      return geometry.sidebar.width === 380 && geometry.toolbar.right === geometry.sidebar.left;
    }, 'toolbar yields to the 380px sidebar', { context: () => JSON.stringify(geometry) });
    assert.deepEqual(geometry.canvas, closedCanvas, 'the layout area keeps its size under the sidebar');
    assert.ok(geometry.canvas.right > geometry.sidebar.left, 'the sidebar covers the layout area');
    assert.equal(await runSize(context, runId), closedSize, 'overlay leaves the PTY size unchanged');
    // An ephemeral panel puts a tray below the layout area, which yields too.
    const tray = await evaluate(`window.workbench.addPanel(${JSON.stringify(created.projects[0].id)}, 'codex')`);
    await until(() => evaluate(`!!document.querySelector('.panel-tray [data-tray-panel-id="${tray.panel.id}"]')`), 'tray card drawn');
    await until(async () => (await box(evaluate, '.panel-tray')).right === (await box(evaluate, '.issue-sidebar')).left, 'tray yields to the sidebar');
    await evaluate(`window.workbench.closePanel(${JSON.stringify(created.projects[0].id)}, ${JSON.stringify(tray.panel.id)})`);
    await until(() => evaluate('!document.querySelector(".panel-tray:not(.empty)")'), 'tray empty again');

    // Squeeze: the layout area narrows beside the sidebar and the PTY follows it.
    await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "squeeze" })');
    await until(async () => {
      const canvas = await box(evaluate, '.canvas'), sidebar = await box(evaluate, '.issue-sidebar');
      return canvas.right <= sidebar.left;
    }, 'layout area narrowed beside the sidebar');
    let squeezed;
    await until(async () => (squeezed = await runSize(context, runId)) !== closedSize && Number(squeezed.split('x')[0]) < Number(closedSize.split('x')[0]),
      'squeezing resized the PTY to fewer columns', { context: () => `closed ${closedSize}, now ${squeezed}` });

    // The shortcut closes the sidebar wherever focus is, here in the terminal, and the PTY widens again.
    await evaluate(`document.querySelector('[data-panel-id="${panel.id}"] .xterm-helper-textarea').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['meta', 'alt'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['meta', 'alt'] });
    await until(() => evaluate('!document.querySelector(".issue-sidebar")'), 'shortcut closed the sidebar from the terminal');
    await until(async () => await runSize(context, runId) === closedSize, 'PTY back to its size without the sidebar');

    // Leave the sidebar open and wider for the second launch.
    await click('Open issue sidebar');
    await until(() => evaluate('!!document.querySelector(".issue-sidebar")'), 'sidebar open again');
    const edge = await evaluate(`(() => { const r = document.querySelector('.issue-sidebar-resize').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...edge, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: edge.x - 70, y: edge.y, button: 'left', modifiers: ['leftbuttondown'] });
    window.webContents.sendInputEvent({ type: 'mouseUp', x: edge.x - 70, y: edge.y, button: 'left', clickCount: 1 });
    await until(async () => JSON.stringify((await evaluate('window.workbench.snapshot()')).issueSidebar) === JSON.stringify({ visible: true, width: 450 }),
      'dragging the left edge saved a 450px sidebar');
    console.log('Overlay kept the layout area and PTY size while the toolbar and tray yielded; squeeze narrowed the layout area and resized the PTY; the shortcut closed the sidebar from the terminal; dragging saved the width.');
  },
  async reopen({ evaluate, until }) {
    await until(async () => JSON.stringify((await evaluate('window.workbench.snapshot()')).issueSidebar) === JSON.stringify({ visible: true, width: 450 }), 'reopened with the saved sidebar state');
    await until(async () => (await box(evaluate, '.issue-sidebar'))?.width === 450, 'reopened sidebar drawn open at 450px');
    console.log('Reopening restored the open sidebar and its width.');
  },
};
