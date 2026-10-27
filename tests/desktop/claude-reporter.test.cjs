const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { showing } = require('./support/panel-views.cjs');

module.exports = {
  async run({ window, evaluate, until, click, directory }) {
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/claude-cli.cjs')] };
    const settings = await evaluate('window.workbench.snapshot().then(snapshot => snapshot.settings)');
    await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { ...settings.agents, claude: command } })})`);
    const created = await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Claude hook panels', directory,
      total: 2, counts: { codex: 0, claude: 2, pi: 0 } })})`);
    const project = created.project.id;
    await click(created.project.name);
    const runs = created.launches.map(launch => launch.run);
    const label = (run, selector) => `document.querySelector('[${selector}="${run.panelId}"] .processing-status')?.getAttribute('aria-label')`;
    async function check(run, expected) {
      await until(() => evaluate(`${label(run, 'data-panel-id')} === ${JSON.stringify(expected)}`));
      assert.equal(await evaluate(label(run, 'data-locate-panel-id')), expected);
    }
    async function emit(run, payload) {
      await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id: payload.hook_event_name, payload }) + '\n')})`);
    }
    for (const run of runs) await check(run, 'Ready');
    await emit(runs[0], { hook_event_name: 'UserPromptSubmit' });
    await check(runs[0], 'Busy'); await check(runs[1], 'Ready');
    await emit(runs[0], { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' });
    await check(runs[0], 'Needs input');
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(showing(snapshot, project, 'needs-input'), [[runs[0].panelId, runs[0].id]]);
    await emit(runs[1], { hook_event_name: 'Stop' });
    await check(runs[1], 'Done'); await check(runs[0], 'Needs input');
    await emit(runs[0], { hook_event_name: 'PostToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'question' });
    await check(runs[0], 'Busy');
    await emit(runs[0], { hook_event_name: 'StopFailure' });
    await check(runs[0], 'Error');
    // Input travels through the actual renderer terminal after an observation error.
    await evaluate(`document.querySelector('[data-panel-id="${runs[0].panelId}"] .xterm-helper-textarea').focus()`);
    for (const character of JSON.stringify({ id: 'keyboard', payload: { hook_event_name: 'UserPromptSubmit' } })) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await check(runs[0], 'Busy'); await check(runs[1], 'Done');
    console.log('Claude native hooks preserve terminal input and matching panel, navigation and Workbench membership across isolated runs.');
  },
};
