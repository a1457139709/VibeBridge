const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

const rect = (evaluate, selector) => evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return box && { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }; })()`);

module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, { account: 'octo', repositories: ['octo/desktop'], issues: [
      { number: 7, title: 'Desktop issue', state: 'OPEN', createdAt: new Date().toISOString(), labels: [], bodyHTML: '<p>Detail body</p>' },
    ] });
    const snapshot = await require('./support/project.cjs')(base, 'Detail project', { Codex: 1 });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, reportedSize } = context;
    const closeDetail = () => evaluate('document.querySelector(".forge-detail-bar button[aria-label=Close]").click()');
    const project = snapshot.projects[0];
    const [run] = runsOf(snapshot);
    assert.equal((await evaluate(`window.workbench.editProject(${JSON.stringify(project.id)}, { name: ${JSON.stringify(project.name)},
      directory: ${JSON.stringify(project.directory)}, repository: { forge: 'github', path: 'octo/desktop' } }, false)`)).error, undefined);
    // A tray panel shows the tray, so the detail has a toolbar above it and a tray below it.
    await evaluate(`window.workbench.addPanel(${JSON.stringify(project.id)}, 'codex')`);
    await until(async () => !!(await evaluate('!!document.querySelector(".panel-tray:not(.empty)")')), 'tray shows its panel');
    // The sidebar overlays, so opening it leaves the layout area as it is; only the detail is under test.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })')).ok);
    const drawnRows = () => evaluate('document.querySelector(".canvas .xterm-rows").children.length');
    let initial;
    await until(async () => (initial = await reportedSize(run.id)).rows === await drawnRows(), 'run reports the rows the terminal shows');
    await click('Show the GitHub sidebar');
    await until(() => evaluate('document.querySelector(".forge-row-title")?.textContent === "Desktop issue"'), 'issue row listed');
    await click('Desktop issue');
    await until(() => evaluate('document.querySelector(".forge-detail h2")?.textContent === "Desktop issue #7"'), 'issue detail drawn');
    const toolbar = await rect(evaluate, '.workspace-toolbar'), tray = await rect(evaluate, '.panel-tray');
    const canvas = await rect(evaluate, '.canvas');

    // Overlay (the default): the detail covers the layout area between the toolbar and the tray, and the layout area keeps
    // its box. That the PTY then keeps its size is a "does not happen" claim the desktop suite cannot prove (ADR 0005):
    // the PTY follows the terminal's box, and this geometry leaves that box where it was.
    const between = async () => { const box = await rect(evaluate, '.forge-detail'); return box?.top === toolbar.bottom && box.bottom === tray.top; };
    await until(between, 'the detail sits between the workspace toolbar and the tray');
    const detail = await rect(evaluate, '.forge-detail');
    assert.ok(detail.left < canvas.right, 'the detail covers the layout area');
    assert.deepEqual(await rect(evaluate, '.canvas'), canvas, 'the layout area keeps its box');
    assert.equal(await evaluate('document.querySelectorAll(".forge-row").length'), 1, 'the list stays visible');
    await closeDetail();
    await until(async () => !(await rect(evaluate, '.forge-detail')), 'detail closed');

    // Squeeze: the layout area ends where the detail begins, and the terminal and its PTY follow.
    assert.ok((await evaluate('window.workbench.saveSettings({ detailCoexistence: "squeeze" })')).ok);
    await click('Desktop issue');
    await until(async () => (await rect(evaluate, '.canvas'))?.right <= (await rect(evaluate, '.forge-detail'))?.left, 'squeezing detail ends the layout area at its left edge');
    await until(between, 'the squeezing detail also sits between the workspace toolbar and the tray');
    await until(async () => (await reportedSize(run.id)).cols < initial.cols, 'squeezing the layout area resizes the PTY to fewer columns');
    await closeDetail();
    await until(async () => (await reportedSize(run.id)).cols === initial.cols, 'closing the squeezing detail gives the PTY its columns back');
    console.log('An overlaying detail lay between the toolbar and tray over the layout area; a squeezing one narrowed it and resized the PTY.');
  },
};
