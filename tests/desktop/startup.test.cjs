const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

module.exports = {
  async run({ evaluate, directory }) {
    assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Create project');
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(snapshot.projects, []);
    assert.deepEqual(runsOf(snapshot), []);
    assert.deepEqual(snapshot.errors, []);
    const inspected = await evaluate(`window.workbench.inspectDirectory(${JSON.stringify(directory)})`);
    assert.equal(inspected.valid, true);
    console.log('Application rendered and preload/main-process IPC returned an isolated directory inspection.');
  },
};
