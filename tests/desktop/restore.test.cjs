const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');

async function renderedLayout(evaluate, project) {
  return evaluate(`(() => {
    const canvas = document.querySelector('.canvas').getBoundingClientRect();
    return ${JSON.stringify(project.panels)}.map(panel => {
      const box = document.querySelector('[data-panel-id="' + panel.id + '"]').getBoundingClientRect();
      return [panel.id, ...[(box.x - canvas.x) / canvas.width, (box.y - canvas.y) / canvas.height,
        box.width / canvas.width, box.height / canvas.height].map(value => Math.round(value * 1000) / 1000)];
    });
  })()`);
}

module.exports = {
  async run(context) {
    const { evaluate, until, click, directory } = context;
    const created = await require('./support/project.cjs')(context, 'Saved project');
    const project = created.projects[0];
    await evaluate(`window.workbench.addPanel(${JSON.stringify(project.id)}, 'pi')`);
    const configured = (await evaluate('window.workbench.snapshot()')).projects[0];
    const [a, b] = configured.panels.map(panel => panel.id);
    const layout = { axis: 'row', ratio: .35, first: { panel: b }, second: { panel: a } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(project.id)}, ${JSON.stringify(layout)})`);
    const otherDirectory = `${directory}/other`; await mkdir(otherDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Other project', directory: otherDirectory, total: 1, counts: { codex: 0, claude: 1, pi: 0 } })})`);
    await click('Saved project');
    await until(() => evaluate(`document.querySelectorAll('.canvas [data-panel-id]').length === 2`));
    const expected = [[a, .35, 0, .65, 1], [b, 0, 0, .35, 1]];
    await until(async () => JSON.stringify(await renderedLayout(evaluate, configured)) === JSON.stringify(expected));
    const snapshot = await evaluate('window.workbench.snapshot()');
    await writeFile(`${directory}/expected.json`, JSON.stringify({ snapshot, geometry: expected }));
    console.log('Saved two projects, distinct Agent panel configurations and a non-default layout.');
  },
  async reopen({ evaluate, until, directory }) {
    const { snapshot: saved, geometry } = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(async () => (await evaluate('window.workbench.snapshot()')).runs.filter(run => run.state === 'running').length === active.panels.length);
    const reopened = await evaluate('window.workbench.snapshot()');
    assert.equal(reopened.activeProjectId, saved.activeProjectId);
    assert.deepEqual(reopened.projects, saved.projects);
    assert.ok(reopened.runs.every(run => run.projectId === active.id && !saved.runs.some(old => old.id === run.id)));
    await until(async () => JSON.stringify(await renderedLayout(evaluate, active)) === JSON.stringify(geometry));
    assert.equal(await evaluate('document.querySelector(".workspace-toolbar strong").textContent'), 'Saved project');
    console.log('Reopening restored project/panel configuration and visible layout with fresh runs, not resumed sessions.');
  },
};
