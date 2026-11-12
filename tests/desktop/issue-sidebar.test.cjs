const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

// Asks the run for its size until it answers; the answer is the size the PTY has now.
async function reportedSize({ evaluate, until }, runId) {
  await evaluate(`window.output = ''; window.workbench.sendInput(${JSON.stringify(runId)}, 'size')`);
  await until(() => evaluate('/SIZE:\\d+x\\d+\\r/.test(window.output)'), 'run answered the size query');
  const [, cols, rows] = await evaluate('window.output.match(/SIZE:(\\d+)x(\\d+)/)');
  return { cols: Number(cols), rows: Number(rows) };
}
const rect = (evaluate, selector) => evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return box && { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }; })()`);

module.exports = {
  async run(base) {
    await require('./support/project.cjs')(base, 'Sidebar project', { Codex: 1 });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click } = context;
    const [run] = runsOf(await evaluate('window.workbench.snapshot()'));
    const drawnRows = () => evaluate('document.querySelector(".xterm-rows").children.length');
    let initial;
    await until(async () => (initial = await reportedSize(context, run.id)).rows === await drawnRows(), 'run reports the rows the terminal shows');
    const canvas = await rect(evaluate, '.canvas');

    // Overlay: the sidebar covers the layout area, which keeps its size; the toolbar and tray make room.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })')).ok);
    await click('Show the GitHub sidebar');
    await until(async () => (await rect(evaluate, '.issue-sidebar'))?.width === 380, 'overlaying sidebar drawn 380px wide');
    const sidebar = await rect(evaluate, '.issue-sidebar');
    assert.deepEqual(await rect(evaluate, '.canvas'), canvas, 'the layout area keeps its size under the overlay');
    assert.ok(sidebar.left < canvas.right, 'the sidebar covers the layout area');
    assert.ok((await rect(evaluate, '.workspace-toolbar > button')).right <= sidebar.left, 'the toolbar makes room for the sidebar');
    assert.deepEqual(await reportedSize(context, run.id), initial, 'overlaying the layout area leaves the PTY size unchanged');
    await click('Hide the GitHub sidebar');
    await until(async () => !(await rect(evaluate, '.issue-sidebar')), 'sidebar closed');

    // Squeeze: the layout area narrows and the terminal and its PTY follow.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "squeeze" })')).ok);
    await click('Show the GitHub sidebar');
    await until(async () => (await rect(evaluate, '.canvas'))?.width < canvas.width, 'squeezing sidebar narrows the layout area');
    await until(async () => (await reportedSize(context, run.id)).cols < initial.cols, 'squeezing the layout area resizes the PTY to fewer columns');

    await evaluate('window.workbench.saveIssueSidebar({ visible: true, width: 450 })');
    await until(async () => (await rect(evaluate, '.issue-sidebar'))?.width === 450, 'sidebar drawn at its saved 450px width');
    console.log('Overlay kept the layout area and PTY size while the toolbar made room; squeeze narrowed the layout area and resized the PTY.');
  },
  async reopen({ evaluate, until }) {
    await until(async () => (await evaluate(`document.querySelector('.issue-sidebar')?.getBoundingClientRect().width`)) === 450, 'reopened sidebar drawn open at 450px');
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).issueSidebar, { visible: true, width: 450 });
    assert.equal(await evaluate(`document.querySelector('.issue-sidebar-toggle').getAttribute('aria-expanded')`), 'true');
    console.log('Reopening restored the open sidebar and its width.');
  },
};
