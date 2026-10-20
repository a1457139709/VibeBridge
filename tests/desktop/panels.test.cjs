const assert = require('node:assert/strict');
const { readFile, writeFile } = require('node:fs/promises');

module.exports = {
  async run(context) {
    const { window, evaluate, until, directory, click } = context;
    const before = await require('./support/project.cjs')(context, ['codex', 'codex', 'codex']);
    const project = before.projects[0];
    let runs = before.runs;
    const [a, b, c] = project.panels.map(panel => panel.id);
    const screenshot = require('./support/evidence.cjs')(window);
    const titles = ['Alpha billing workspace', 'Bravo review workspace', 'Charlie release workspace'];
    for (const [index, id] of [a, b, c].entries()) {
      const run = runs.find(run => run.panelId === id);
      await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify('title:' + titles[index] + ' | directory')})`);
      await until(() => evaluate(`document.querySelector('[data-panel-id="${id}"] .session-title').textContent === ${JSON.stringify(titles[index])}`));
    }
    runs = (await evaluate('window.workbench.snapshot()')).runs;
    const { settle, save } = require('./support/panel-driver.cjs')(context, project.id);
    const layout = { axis: 'row', ratio: .6, first: { panel: a }, second: { axis: 'column', ratio: .5, first: { panel: b }, second: { panel: c } } };
    window.focus(); window.webContents.focus();
    await save(layout);
    await screenshot('panels-before-shrink');
    if (process.env.VIBEBRIDGE_TEST_EVIDENCE) {
      await click('添加 Agent'); await screenshot('icons-add-agent'); await click('关闭添加 Agent');
      await click('添加项目');
      for (const label of ['增加Codex', '增加Claude Code', '增加pi']) await click(label);
      await evaluate(`document.querySelector('.preview').scrollIntoView({ block: 'center' })`);
      await screenshot('icons-setup-preview');
      await evaluate(`document.querySelector('.quantity-row').scrollIntoView({ block: 'center' })`);
      await screenshot('icons-setup'); await click('取消'); await settle();
      await click('全局设置'); await screenshot('icons-settings'); await click('‹ 返回'); await settle();
    }
    await evaluate(`document.querySelector('[data-panel-id="${b}"] .panel-header').click()`);
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(b)}`));
    await click('全局设置'); await settle();
    await click('‹ 返回');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(b)}`));
    await evaluate(`window.originalTerminal = document.querySelector('[data-panel-id="${a}"] .xterm'); void 0;`);
    const fixture = { project, runs, titles, layout };
    await require('./scenarios/panel-sizing.cjs')(context, fixture);
    await require('./scenarios/panel-swap-titles.cjs')(context, fixture);
    await require('./scenarios/panel-swap.cjs')(context, fixture);
    await writeFile(`${directory}/panels-expected.json`, JSON.stringify(await evaluate('window.workbench.snapshot()')));
  },
  async reopen({ evaluate, until, directory }) {
    const saved = JSON.parse(await readFile(`${directory}/panels-expected.json`, 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(async () => (await evaluate('window.workbench.snapshot()')).runs.length === active.panels.length);
    const reopened = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(reopened.projects, saved.projects, 'Reopening restores only the committed arrangements');
    assert.ok(reopened.runs.every(run => !saved.runs.some(old => old.id === run.id)));
    await until(() => evaluate(`document.querySelectorAll('.canvas .xterm').length === ${active.panels.length}`));
    console.log('Panel drag commit restored after quit/reopen with new CLI instances.');
  },
};
