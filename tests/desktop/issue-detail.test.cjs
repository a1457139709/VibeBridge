const assert = require('node:assert/strict');

// The run's answer to a size query: the PTY size the run has now, as COLUMNSxROWS.
async function runSize({ evaluate, until }, runId) {
  await evaluate(`window.output = ''; window.workbench.sendInput(${JSON.stringify(runId)}, 'size')`);
  await until(() => evaluate('/SIZE:\\d+x\\d+\\r/.test(window.output)'), 'run answered the size query');
  return evaluate('window.output.match(/SIZE:(\\d+x\\d+)\\r/)[1]');
}

const box = (evaluate, selector) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return r && { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; })()`);

module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, { login: 'octo', repositories: ['octo/app'],
      issues: [{ number: 1, title: 'Detail issue', state: 'OPEN', stateReason: null, createdAt: '2026-01-01T00:00:00Z', labels: [], author: 'octo', bodyHTML: '<p>Detail body</p>' }] });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, window } = context;
    window.setContentSize(1280, 800);
    await until(() => evaluate('document.documentElement.clientWidth === 1280'), 'window content is 1280px wide');
    const created = await require('./support/project.cjs')(context, 'Detail project', { Codex: 1 });
    const project = created.projects[0];
    const runId = project.panels[0].run.id;
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'), 'terminal shows READY:');
    await evaluate(`window.workbench.bindRepository(${JSON.stringify(project.id)}, { platform: 'github', path: 'octo/app' })`);
    // The sidebar overlays, so only the detail can change the layout area.
    await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })');
    await until(async () => (await evaluate('window.workbench.snapshot()')).settings.sidebarCoexistence === 'overlay', 'sidebar overlay saved');
    const closedCanvas = await box(evaluate, '.canvas');
    const closedSize = await runSize(context, runId);

    await click('Open issue sidebar');
    await until(() => evaluate('!!document.querySelector(".issue-row .issue-row-title")'), 'issue row listed');
    await evaluate('document.querySelector(".issue-row .issue-row-title").click()');
    await until(() => evaluate('document.querySelector(".issue-detail")?.textContent.includes("Detail body") ?? false'), 'detail shows the issue body');

    // Overlay (the default): the detail lies between the toolbar and the tray, left of the sidebar, and nothing resizes.
    let geometry;
    await until(async () => {
      geometry = { detail: await box(evaluate, '.issue-detail'), sidebar: await box(evaluate, '.issue-sidebar'),
        toolbar: await box(evaluate, '.workspace-toolbar'), canvas: await box(evaluate, '.canvas'), list: await box(evaluate, '.issue-list') };
      return geometry.detail.right === geometry.sidebar.left && geometry.detail.top >= geometry.toolbar.bottom;
    }, 'detail opens leftwards from the sidebar edge below the toolbar', { context: () => JSON.stringify(geometry) });
    assert.deepEqual(geometry.canvas, closedCanvas, 'the layout area keeps its size under the detail');
    assert.ok(geometry.list.width > 0, 'the list stays visible');
    assert.equal(await runSize(context, runId), closedSize, 'overlay leaves the PTY size unchanged');

    // Squeeze: the layout area narrows beside the detail and the PTY follows it.
    await evaluate('window.workbench.saveSettings({ detailCoexistence: "squeeze" })');
    await until(async () => (await box(evaluate, '.canvas')).right <= (await box(evaluate, '.issue-detail')).left, 'layout area narrowed beside the detail');
    let squeezed;
    await until(async () => (squeezed = await runSize(context, runId)) !== closedSize && Number(squeezed.split('x')[0]) < Number(closedSize.split('x')[0]),
      'squeezing resized the PTY to fewer columns', { context: () => `closed ${closedSize}, now ${squeezed}` });

    await click('Close detail');
    await until(() => evaluate('!document.querySelector(".issue-detail")'), 'detail closed');
    await until(async () => await runSize(context, runId) === closedSize, 'PTY back to its size without the detail');
    console.log('Overlay kept the layout area and PTY size beside the list; squeeze narrowed the layout area and resized the PTY; closing restored it.');
  },
};
