const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');
const { panelViews } = require('./support/panel-views.cjs');
const dragging = require('./support/dragging.cjs');

module.exports = {
  async run(context) {
    const { window, evaluate, until } = context;
    const { rect, center, geometry, press, hover, release, previewBox } = dragging(context);
    const created = await require('./support/project.cjs')(context, 'Tray conversion', { Codex: 2 });
    const projectId = created.projects[0].id;
    const [a, b] = created.projects[0].panels.map(panel => panel.id);
    const project = async () => (await evaluate('window.workbench.fetchSnapshot()')).projects[0];
    const add = agent =>
      evaluate(`window.workbench.addPanel(${JSON.stringify(projectId)}, '${agent}')`).then(result => result.panel.id);
    const t1 = await add('pi'),
      t2 = await add('claude');
    await until(
      async () => panelViews({ projects: [await project()] }).every(panel => panel.run?.state === 'running'),
      'every resident and tray run running',
    );
    const runs = Object.fromEntries(panelViews({ projects: [await project()] }).map(panel => [panel.id, panel.run.id]));
    const tray = async () => (await project()).tray.map(panel => panel.id);
    const settle = async (expected, expectedTray) => {
      await until(
        async () => JSON.stringify(await tray()) === JSON.stringify(expectedTray),
        `tray holds ${JSON.stringify(expectedTray)}`,
      );
      await until(
        async () => JSON.stringify(await geometry(Object.keys(expected))) === JSON.stringify(expected),
        `panel geometry settles at ${JSON.stringify(expected)}`,
      );
      assert.deepEqual(
        Object.fromEntries(panelViews({ projects: [await project()] }).map(panel => [panel.id, panel.run.id])),
        runs,
      );
    };
    const card = id => `[data-tray-panel-id="${id}"]`;
    await settle({ [a]: [0, 0, 0.5, 1], [b]: [0.5, 0, 0.5, 1] }, [t1, t2]);

    let target = await rect(`[data-panel-id="${b}"]`);
    let point = { x: Math.round(target.left + target.width * 0.1), y: Math.round(target.top + target.height / 2) };
    await press(card(t1));
    await hover(point, 'Drop preview: pi on the left of Codex');
    assert.deepEqual(await previewBox(), [0.5, 0, 0.25, 1]);
    release(point);
    await settle({ [a]: [0, 0, 0.5, 1], [t1]: [0.5, 0, 0.25, 1], [b]: [0.75, 0, 0.25, 1] }, [t2]);
    assert.equal(
      await evaluate('document.querySelector(".tray-card[aria-pressed=true]")'),
      null,
      'a drag does not open the card',
    );

    target = await rect(`[data-panel-id="${a}"]`);
    point = center(target);
    await press(card(t2));
    await hover(point, 'Swap preview: Claude Code and Codex');
    release(point);
    await settle({ [t2]: [0, 0, 0.5, 1], [t1]: [0.5, 0, 0.25, 1], [b]: [0.75, 0, 0.25, 1] }, [a]);

    const canvas = await rect('.canvas');
    point = { x: Math.round(canvas.left + canvas.width / 4), y: Math.round(canvas.bottom - 8) };
    await press(card(a));
    await hover(point, 'Drop preview: Codex along the bottom of the layout area');
    assert.deepEqual(await previewBox(), [0, 0.5, 1, 0.5]);
    release(point);
    await settle(
      { [t2]: [0, 0, 0.5, 0.5], [t1]: [0.5, 0, 0.25, 0.5], [b]: [0.75, 0, 0.25, 0.5], [a]: [0, 0.5, 1, 0.5] },
      [],
    );

    point = center(await rect('.panel-tray'));
    await press(`[data-panel-id="${t1}"] .panel-header`);
    await hover(point, 'Drop preview: pi moves to the tray');
    release(point);
    const layout = { [t2]: [0, 0, 0.5, 0.5], [b]: [0.5, 0, 0.5, 0.5], [a]: [0, 0.5, 1, 0.5] };
    await settle(layout, [t1]);

    point = center(await rect(`[data-panel-id="${a}"]`));
    await press(card(t1));
    await hover(point, 'Swap preview: pi and Codex');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(
      () =>
        evaluate(
          '!document.querySelector(".canvas").classList.contains("dragging") && !document.querySelector(".panel-swap-preview")',
        ),
      'Esc ended the drag and removed the swap preview',
    );
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    release(point);
    point = center(await rect('.workspace-toolbar'));
    await press(card(t1));
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left', modifiers: ['leftbuttondown'] });
    release(point);
    await until(
      () => evaluate('!document.querySelector(".canvas").classList.contains("dragging")'),
      'release outside the layout area and the tray ended the drag',
    );
    await settle(layout, [t1]);

    for (const id of [t2, b, a])
      await evaluate(`window.workbench.moveToTray(${JSON.stringify(projectId)}, ${JSON.stringify(id)})`);
    await until(
      async () => (await project()).layout === null,
      'layout empty after moving every resident panel to the tray',
    );
    await evaluate(`document.querySelector('${card(t1)}').click()`);
    await until(
      () => evaluate(`document.querySelector('${card(t1)}').getAttribute('aria-pressed') === 'true'`),
      'tray card of the open panel pressed',
    );
    point = center(await rect('.canvas'));
    await press(`.canvas > [data-panel-id="${t1}"] .panel-header`);
    await hover(point, 'Drop preview: pi fills the layout area');
    assert.deepEqual(await previewBox(), [0, 0, 1, 1]);
    release(point);
    await settle({ [t1]: [0, 0, 1, 1] }, [t2, b, a]);
    assert.deepEqual((await project()).layout, { panel: t1 });
    assert.equal(
      await evaluate('document.querySelector(".tray-card[aria-pressed=true]")'),
      null,
      'the placed panel is resident, not open',
    );
    await writeFile(`${context.directory}/expected.json`, JSON.stringify({ resident: t1 }));
    console.log(
      "Cards dropped on a panel's perimeter, middle and the layout edge became resident; a resident header dropped on the tray became ephemeral; Esc and an invalid release changed nothing; the open tray panel filled the empty layout; every run stayed the same.",
    );
  },
  async reopen({ evaluate, directory }) {
    const { resident } = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
    const project = (await evaluate('window.workbench.fetchSnapshot()')).projects[0];
    assert.deepEqual(project.layout, { panel: resident });
    assert.deepEqual(
      project.panels.map(panel => panel.id),
      [resident],
    );
    assert.deepEqual(project.tray, []);
    console.log('Reopening restored the converted layout; panels moved to the tray did not return.');
  },
};
