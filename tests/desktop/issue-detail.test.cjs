const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

const rect = (evaluate, selector) =>
  evaluate(`(() => { const box = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return box && { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }; })()`);

module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, {
      account: 'octo',
      repositories: ['octo/desktop'],
      issues: [
        {
          number: 7,
          title: 'Desktop issue',
          state: 'OPEN',
          createdAt: new Date().toISOString(),
          labels: [],
          bodyHTML: '<p>Detail body</p>',
        },
      ],
    });
    const snapshot = await require('./support/project.cjs')(base, 'Detail project', { Codex: 1 });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, reportedSize } = context;
    const closeDetail = () => evaluate('document.querySelector(".forge-detail-bar button[aria-label=Close]").click()');
    const project = snapshot.projects[0];
    const [run] = runsOf(snapshot);
    // Bound as Bind in the Forge sidebar binds octo/desktop.
    await evaluate(`(async () => window.workbench.bindRepository(${JSON.stringify(project.id)},
      (await window.workbench.repositoryChoices(${JSON.stringify(project.id)}, ${JSON.stringify(project.directory)}))
        .repositories.find(item => item.path === 'octo/desktop')))()`);
    // A tray panel shows the tray, so the detail has a toolbar above it and a tray below it.
    await evaluate(`window.workbench.addPanel(${JSON.stringify(project.id)}, 'codex')`);
    await until(
      async () => !!(await evaluate('!!document.querySelector(".panel-tray:not(.empty)")')),
      'tray shows its panel',
    );
    // The sidebar overlays, so opening it leaves the layout area as it is; only the detail is under test.
    assert.ok((await evaluate('window.workbench.saveSettings({ sidebarCoexistence: "overlay" })')).ok);
    const drawnRows = () => evaluate('document.querySelector(".canvas .xterm-rows").children.length');
    let initial;
    await until(
      async () => (initial = await reportedSize(run.id)).rows === (await drawnRows()),
      'run reports the rows the terminal shows',
    );
    await click('Show the GitHub sidebar');
    await until(
      () => evaluate('document.querySelector(".forge-row-title")?.textContent === "Desktop issue"'),
      'issue row listed',
    );
    await click('Desktop issue');
    await until(
      () => evaluate('document.querySelector(".forge-detail h2")?.textContent === "Desktop issue #7"'),
      'issue detail drawn',
    );
    const toolbar = await rect(evaluate, '.workspace-toolbar'),
      tray = await rect(evaluate, '.panel-tray');
    const canvas = await rect(evaluate, '.canvas');

    // Overlay (the default): the detail covers the layout area between the toolbar and the tray, and the layout area keeps
    // its box. That the PTY then keeps its size is a "does not happen" claim the desktop suite cannot prove (ADR 0005):
    // the PTY follows the terminal's box, and tests/components/IssueDetail.test.tsx shows the layout area left as it was.
    const between = async () => {
      const box = await rect(evaluate, '.forge-detail');
      return box?.top === toolbar.bottom && box.bottom === tray.top;
    };
    await until(between, 'the detail sits between the workspace toolbar and the tray');
    const detail = await rect(evaluate, '.forge-detail');
    assert.ok(detail.left < canvas.right, 'the detail covers the layout area');
    assert.deepEqual(await rect(evaluate, '.canvas'), canvas, 'the layout area keeps its box');
    assert.equal(await evaluate('document.querySelectorAll(".forge-row").length'), 1, 'the list stays visible');
    await closeDetail();
    await until(async () => !(await rect(evaluate, '.forge-detail')), 'detail closed');

    // Squeeze: the layout area gives up the detail's width. A detail wider than the room beside the navigation covers the
    // navigation (in a 1024px window, as on the CI runner) and leaves the layout area no width. The PTY then keeps its
    // size until the area has width again (#234): a "does not happen" claim the desktop suite cannot prove (ADR 0005).
    assert.ok((await evaluate('window.workbench.saveSettings({ detailCoexistence: "squeeze" })')).ok);
    await click('Desktop issue');
    await until(async () => {
      const [area, detail] = [await rect(evaluate, '.canvas'), await rect(evaluate, '.forge-detail')];
      return !!area && !!detail && (area.right <= detail.left || area.right === area.left);
    }, 'squeezing detail ends the layout area at its left edge, or leaves it no width');
    await until(between, 'the squeezing detail also sits between the workspace toolbar and the tray');

    // The narrowest sidebar and detail leave the layout area width beside the navigation in any window the app opens in:
    // it ends where the detail begins, and the terminal and its PTY follow it.
    await evaluate(`window.workbench.saveSidebar('forgeSidebar', { visible: true, width: 300 })`);
    await until(async () => {
      const sidebar = await rect(evaluate, '.forge-sidebar');
      return sidebar.right - sidebar.left === 300;
    }, 'sidebar drawn 300px wide');
    const edge = await rect(evaluate, '.forge-detail-resize');
    const from = { x: Math.round((edge.left + edge.right) / 2), y: Math.round((edge.top + edge.bottom) / 2) };
    const held = { button: 'left', modifiers: ['leftbuttondown'] };
    base.window.webContents.sendInputEvent({ type: 'mouseDown', ...from, ...held, clickCount: 1 });
    base.window.webContents.sendInputEvent({ type: 'mouseMove', x: from.x + 1000, y: from.y, ...held });
    base.window.webContents.sendInputEvent({
      type: 'mouseUp',
      x: from.x + 1000,
      y: from.y,
      button: 'left',
      clickCount: 1,
    });
    await until(async () => {
      const [area, detail] = [await rect(evaluate, '.canvas'), await rect(evaluate, '.forge-detail')];
      return area.right > area.left && area.right <= detail.left;
    }, 'the narrowest squeezing detail ends the layout area, with width, at its left edge');
    await until(
      async () => (await reportedSize(run.id)).cols < initial.cols,
      'squeezing the layout area resizes the PTY to fewer columns',
    );
    await closeDetail();
    // xterm measures the character width again as the terminal resizes, and a fraction of a pixel can move a width that
    // holds a whole number of columns one column down, so the columns given back may be one fewer.
    await until(
      async () => (await reportedSize(run.id)).cols >= initial.cols - 1,
      'closing the squeezing detail gives the PTY its columns back',
    );
    console.log(
      'An overlaying detail lay between the toolbar and tray over the layout area; a squeezing one ended it at its left edge or left it no width, and a narrower one left it width the PTY followed.',
    );
  },
};
