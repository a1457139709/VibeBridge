const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { showing } = require('./support/panel-views.cjs');

module.exports = {
  async run({ window, evaluate, until, click, directory }) {
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/pi-cli.cjs')] };
    const settings = await evaluate('window.workbench.snapshot().then(snapshot => snapshot.settings)');
    await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { ...settings.agents, pi: command } })})`);
    const created = await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'pi extension panels', directory,
      total: 2, counts: { codex: 0, claude: 0, pi: 2 } })})`);
    await click(created.project.name);
    const runs = created.launches.map(launch => launch.run);
    const label = (run, selector) => `document.querySelector('[${selector}="${run.panelId}"] .processing-status')?.getAttribute('aria-label')`;
    async function check(run, expected) {
      await until(() => evaluate(`${label(run, 'data-panel-id')} === ${JSON.stringify(expected)}`));
      assert.equal(await evaluate(label(run, 'data-locate-panel-id')), expected);
    }
    async function emit(run, payload, options = {}) {
      await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id: payload.type, payload, ...options }) + '\n')})`);
    }
    for (const run of runs) await check(run, 'Ready');
    await emit(runs[0], { type: 'agent_start' });
    await check(runs[0], 'Busy'); await check(runs[1], 'Ready');
    await emit(runs[0], { type: 'ui_prompt_start' });
    await check(runs[0], 'Needs input');
    await emit(runs[0], { type: 'tool_execution_end', isError: true });
    await check(runs[0], 'Needs input');
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(showing(snapshot, created.project.id, 'needs-input'),
      [[runs[0].panelId, runs[0].id]]);
    await emit(runs[1], { type: 'agent_start' });
    await emit(runs[1], { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await emit(runs[1], { type: 'agent_end' });
    await check(runs[1], 'Busy');
    await emit(runs[1], { type: 'agent_settled' });
    await check(runs[1], 'Done'); await check(runs[0], 'Needs input');
    for (let i = 0; i < 2; i++) {
      await emit(runs[1], { type: 'session_before_compact', reason: 'manual' }, { idle: false });
      await check(runs[1], 'Busy');
    }
    await emit(runs[1], { type: 'session_compact', reason: 'manual', willRetry: false }, { idle: false });
    await check(runs[1], 'Busy');
    await emit(runs[1], { type: 'session_compact', reason: 'manual', willRetry: false }, { idle: true });
    await check(runs[1], 'Done'); await check(runs[0], 'Needs input');
    const compacted = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(showing(compacted, created.project.id, 'done'),
      [[runs[1].panelId, runs[1].id]]);
    await emit(runs[0], { type: 'ui_prompt_end' });
    await check(runs[0], 'Busy');
    await emit(runs[0], { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } });
    await emit(runs[0], { type: 'agent_settled' });
    await check(runs[0], 'Error');
    await evaluate(`document.querySelector('[data-panel-id="${runs[0].panelId}"] .xterm-helper-textarea').focus()`);
    for (const character of JSON.stringify({ id: 'keyboard', payload: { type: 'agent_start' } })) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await check(runs[0], 'Busy'); await check(runs[1], 'Done');
    console.log('pi extensions preserve terminal input and consistent panel, navigation and Workbench membership across parallel runs.');
  },
};
