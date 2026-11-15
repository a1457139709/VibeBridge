const assert = require('node:assert/strict');

/** Whether every corner of the element is inside the window and draws the element itself, so nothing clips or covers it. */
const drawnWhole = selector => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const box = element.getBoundingClientRect();
  return [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]]
    .every(([x, y]) => x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight && element.contains(document.elementFromPoint(x, y)));
})()`;
/** The text of each target drawn with a background. */
const highlighted = `[...document.querySelectorAll('.dispatch-targets [role=menuitem]')]
  .filter(item => getComputedStyle(item).backgroundColor !== 'rgba(0, 0, 0, 0)').map(item => item.textContent)`;

module.exports = {
  async run(context) {
    await require('./support/gh-double.cjs')(context.directory, { account: 'octo', repositories: ['octo/desktop'], issues: [
      { number: 7, title: 'Dispatched issue', state: 'OPEN', createdAt: new Date().toISOString(), labels: [], bodyHTML: '<p>Body</p>' },
    ] });
    const snapshot = await require('./support/project.cjs')(context, 'Dispatch menu project', { Codex: 1 });
    const { window, evaluate, until, click } = context;
    const { rect, center } = require('./support/dragging.cjs')(context);
    const project = snapshot.projects[0];
    assert.equal((await evaluate(`window.workbench.editProject(${JSON.stringify(project.id)}, { name: ${JSON.stringify(project.name)},
      directory: ${JSON.stringify(project.directory)}, repository: { forge: 'github', path: 'octo/desktop' } }, false)`)).error, undefined);
    await click('Show the GitHub sidebar');
    await until(() => evaluate('document.querySelector(".forge-row-title")?.textContent === "Dispatched issue"'), 'issue row listed');
    const point = async selector => window.webContents.sendInputEvent({ type: 'mouseMove', ...center(await rect(selector)) });
    const key = keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    };

    for (const [place, scope] of [['row', '.forge-scroll'], ['detail', '.forge-detail']]) {
      if (place === 'detail') {
        await click('Dispatched issue');
        await until(() => evaluate('!!document.querySelector(".forge-detail .dispatch-button")'), 'issue detail open with its Dispatch');
      }
      // The window as it opens, then short: a height any screen fits.
      for (const height of [null, 480]) {
        if (height) {
          window.setContentSize(1280, height);
          await until(() => evaluate(`document.documentElement.clientHeight === ${height}`), `window content is ${height}px high`);
        } else {
          window.setContentSize(1280, 700);
          await until(() => evaluate('document.documentElement.clientWidth === 1280'), 'window content is 1280px wide');
        }
        await evaluate(`document.querySelector('${scope} .dispatch-button').click()`);
        await until(() => evaluate('document.activeElement?.classList.contains("dispatch-menu")'), `dispatch menu open from the ${place}`);
        // The last command opens its targets lowest, leftwards over the workspace.
        await point('.dispatch-menu > [role=menuitem]:last-of-type');
        await until(() => evaluate('!!document.querySelector(".dispatch-targets")'), 'targets of the last command shown');
        await until(() => evaluate(drawnWhole('.dispatch-menu')), `commands drawn whole from the ${place} in a ${height ? `${height}px` : "tall"} window`);
        await until(() => evaluate(drawnWhole('.dispatch-targets')), `targets drawn whole from the ${place} in a ${height ? `${height}px` : "tall"} window`);
        key('Escape');
        await until(() => evaluate('!document.querySelector(".dispatch-menu")'), 'dispatch menu closed');
      }
    }

    // Pointing at a target moves the cursor there; a key moving it on leaves only the cursor highlighted.
    await evaluate('document.querySelector(".forge-detail .dispatch-button").click()');
    await until(() => evaluate('document.activeElement?.classList.contains("dispatch-menu")'), 'dispatch menu open');
    await point('.dispatch-menu > [role=menuitem]:last-of-type');
    await until(() => evaluate('!!document.querySelector(".dispatch-targets")'), 'targets shown');
    await point('.dispatch-targets [role=menuitem]:nth-of-type(2)');
    await until(() => evaluate('document.querySelector(".dispatch-targets [role=menuitem]:nth-of-type(2)").classList.contains("cursor")'), 'pointed target has the cursor');
    key('Down');
    await until(() => evaluate('document.querySelector(".dispatch-targets [role=menuitem]:nth-of-type(3)").classList.contains("cursor")'), 'cursor moved down by key');
    await until(async () => JSON.stringify(await evaluate(highlighted)) === JSON.stringify(['πNew · piEphemeral']), 'only the cursor\'s target highlighted');

    // Each Agent type keeps its type color: the new Codex target's icon matches the Codex panel's in the workspace.
    const colors = await evaluate(`[...document.querySelectorAll('.dispatch-targets [role=menuitem]')].slice(0, 3)
      .map(item => getComputedStyle(item.querySelector('.agent-mark')).color)`);
    const panelColor = await evaluate('getComputedStyle(document.querySelector(".canvas .agent-title .agent-mark")).color');
    assert.equal(new Set(colors).size, 3, `the three Agent types have their own colors: ${colors}`);
    assert.equal(colors[1], panelColor, 'the new Codex target has the Codex panel\'s type color');
    console.log('The dispatch menu drew whole from the row and the detail, highlighted only its cursor, and kept each Agent type\'s color.');
  },
};
