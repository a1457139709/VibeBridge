const assert = require('node:assert/strict');
const dragging = require('./support/dragging.cjs');

module.exports = {
  async run(context) {
    const { window, evaluate, until } = context;
    const { rect, center } = dragging(context);
    const created = await require('./support/project.cjs')(context, 'Hover hints', { Codex: 1 });
    const project = created.projects[0];
    const added = await evaluate(`window.workbench.addPanel(${JSON.stringify(project.id)}, 'pi')`);
    const card = `[data-tray-panel-id="${added.panel.id}"]`;
    await until(() => evaluate(`!!document.querySelector('${card}')`));
    // An added panel opens; collapse it so only the card shows the tray panel.
    await evaluate(`document.querySelector('${card}').click()`);
    await until(() => evaluate(`document.querySelector('${card}').getAttribute('aria-pressed') === 'false'`));
    const hint = () => evaluate('document.querySelector("[role=tooltip]")?.textContent ?? null');
    const hover = async selector => {
      const point = center(await rect(selector));
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      return point;
    };

    // Native title tooltips never show in the window; the drawn hint does, with the element's full description.
    await hover('.project-link');
    await until(async () => (await hint()) === 'Hover hints · 1 panels');
    await hover(`${card} .session-title`);
    await until(async () => (await hint())?.startsWith('pi · '));
    // A card sits at the window bottom, so its hint opens upward and stays inside the window.
    const shown = await rect('[role=tooltip]'), cardBox = await rect(card);
    assert.ok(shown.bottom <= cardBox.top, 'the hint opens above a card at the window bottom');
    assert.ok(shown.left >= 0 && shown.right <= await evaluate('innerWidth'));
    // The status icon inside the card has its own hint.
    await until(() => evaluate(`!!document.querySelector('${card} .processing-status')`));
    await hover(`${card} .processing-status`);
    await until(async () => (await hint()) === await evaluate(`document.querySelector('${card} .processing-status').getAttribute('aria-label')`));
    // Pressing hides the hint; leaving every hinted element keeps it hidden.
    const point = await hover(card);
    await until(async () => (await hint()) !== null);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await until(async () => (await hint()) === null);
    await hover('.canvas');
    await evaluate('new Promise(resolve => setTimeout(resolve, 600))');
    assert.equal(await hint(), null);
    console.log('Hovering the navigation, a tray card and its status icon drew each element\'s hint inside the window; pressing and leaving hid it.');
  },
};
