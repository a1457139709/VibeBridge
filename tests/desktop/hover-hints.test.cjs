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
    await until(
      () => evaluate(`document.querySelector('${card}')?.getAttribute('aria-pressed') === 'false'`),
      `tray card for panel ${added.panel.id} drawn collapsed`,
    );
    const hint = () => evaluate('document.querySelector("[role=tooltip]")?.textContent ?? null');
    const hover = async selector => {
      const point = center(await rect(selector));
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      return point;
    };

    await hover('.project-link');
    await until(
      async () => (await hint()) === 'Hover hints · 2 panels',
      'project link hint reads "Hover hints · 2 panels"',
    );
    await hover(`${card} .session-title`);
    await until(async () => (await hint())?.startsWith('pi · '), 'tray card title hint starts with "pi · "');
    const shown = await rect('[role=tooltip]'),
      cardBox = await rect(card);
    assert.ok(shown.bottom <= cardBox.top, 'the hint opens above a card at the window bottom');
    assert.ok(shown.left >= 0 && shown.right <= (await evaluate('innerWidth')));
    await until(
      () => evaluate(`!!document.querySelector('${card} .processing-status')`),
      'tray card shows its processing status icon',
    );
    await hover(`${card} .processing-status`);
    await until(
      async () =>
        (await hint()) ===
        (await evaluate(`document.querySelector('${card} .processing-status').getAttribute('aria-label')`)),
      'status icon hint matches its accessible name',
    );
    const point = await hover(card);
    await until(async () => (await hint()) !== null, 'tray card hint shown before pressing');
    window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
    await until(async () => (await hint()) === null, 'pressing the tray card hid the hint');
    console.log(
      "Hovering the navigation, a tray card and its status icon drew each element's hint inside the window; pressing hid it.",
    );
  },
};
