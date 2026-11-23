const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { runsOf } = require('./support/panel-views.cjs');
const dragging = require('./support/dragging.cjs');
const { t } = require('./support/localization.cjs');

module.exports = {
  async run(context) {
    const { window, evaluate, until, click, directory } = context;
    const { rect, geometry, press: pressOn, hover, release, previewBox } = dragging(context);
    await require('./support/project.cjs')(context, 'First project');
    const projectDirectory = `${directory}/drops`;
    await mkdir(projectDirectory);
    await evaluate(
      `window.workbench.createProject(${JSON.stringify({ name: 'Drop project', directory: projectDirectory, total: 3, counts: { codex: 1, claude: 1, pi: 1 } })})`,
    );
    await click('Drop project');
    const project = () =>
      evaluate('window.workbench.fetchSnapshot()').then(snapshot =>
        snapshot.projects.find(project => project.name === 'Drop project'),
      );
    await until(
      async () => (await project()).panels.every(panel => panel.run?.state === 'running'),
      'every Drop project run running',
    );
    const created = await project();
    const [a, b, c] = created.panels.map(panel => panel.id);
    const runs = runsOf({ projects: [created] })
      .map(run => run.id)
      .sort();
    await evaluate(
      `window.workbench.saveLayout(${JSON.stringify(created.id)}, ${JSON.stringify({
        axis: 'row',
        ratio: 0.5,
        first: { panel: a },
        second: { axis: 'column', ratio: 0.5, first: { panel: b }, second: { panel: c } },
      })})`,
    );
    const settle = async expected => {
      await until(
        async () => JSON.stringify(await geometry([a, b, c])) === JSON.stringify(expected),
        `panel geometry settles at ${JSON.stringify(expected)}`,
      );
      assert.deepEqual(
        runsOf({ projects: [await project()] })
          .map(run => run.id)
          .sort(),
        runs,
      );
    };
    await settle({ [a]: [0, 0, 0.5, 1], [b]: [0.5, 0, 0.5, 0.5], [c]: [0.5, 0.5, 0.5, 0.5] });
    const press = id => pressOn(`[data-panel-id="${id}"] .panel-header`);

    await press(a);
    const canvas = await rect('.canvas'),
      tray = await rect('.panel-tray');
    let point = { x: Math.round(canvas.left + canvas.width / 4), y: Math.round(tray.top - 8) };
    await hover(point, t('fillPreview', { agent: 'Codex', side: t('sideBottom') }));
    assert.deepEqual(await previewBox(), [0, 0.5, 1, 0.5]);
    release(point);
    await settle({ [a]: [0, 0.5, 1, 0.5], [b]: [0, 0, 1, 0.25], [c]: [0, 0.25, 1, 0.25] });

    let target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width * 0.1), y: Math.round(target.top + target.height / 2) };
    await press(c);
    await hover(point, t('splitPreview', { agent: 'pi', side: t('sideLeft'), target: 'Codex' }));
    assert.deepEqual(await previewBox(), [0, 0.5, 0.5, 0.5]);
    release(point);
    await settle({ [a]: [0.5, 0.5, 0.5, 0.5], [b]: [0, 0, 1, 0.5], [c]: [0, 0.5, 0.5, 0.5] });

    target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(b);
    await hover(point, t('swapPreview', { first: 'Claude Code', second: 'Codex' }));
    release(point);
    const final = { [a]: [0, 0, 1, 0.5], [b]: [0.5, 0.5, 0.5, 0.5], [c]: [0, 0.5, 0.5, 0.5] };
    await settle(final);
    const saved = (await project()).layout;

    target = await rect(`[data-panel-id="${c}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(a);
    await hover(point, t('swapPreview', { first: 'Codex', second: 'pi' }));

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
    target = await rect(`[data-panel-id="${a}"]`);
    point = { x: Math.round(target.left + target.width / 2), y: Math.round(target.top + target.height / 2) };
    await press(a);
    window.webContents.sendInputEvent({ type: 'mouseMove', ...point, button: 'left', modifiers: ['leftbuttondown'] });
    release(point);
    await until(
      () => evaluate('!document.querySelector(".canvas").classList.contains("dragging")'),
      'release over the dragged panel ended the drag',
    );
    await settle(final);
    await writeFile(`${directory}/expected.json`, JSON.stringify({ ids: [a, b, c], layout: saved, geometry: final }));
    console.log(
      'Edge, perimeter and middle drops rearranged resident panels with their runs intact; Esc and an invalid release changed nothing.',
    );
  },
  async reopen(context) {
    const { evaluate, until, directory } = context;
    const { geometry } = dragging(context);
    const { ids, layout, geometry: expected } = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
    const project = (await evaluate('window.workbench.fetchSnapshot()')).projects.find(
      project => project.name === 'Drop project',
    );
    assert.deepEqual(project.layout, layout);
    await until(
      async () => JSON.stringify(await geometry(ids)) === JSON.stringify(expected),
      `reopened layout draws ${JSON.stringify(expected)}`,
    );
    console.log('Reopening restored the rearranged layout.');
  },
};
