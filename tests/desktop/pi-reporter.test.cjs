const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { showing } = require('./support/panel-views.cjs');

module.exports = {
  async run({ window, evaluate, until, click, directory }) {
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/pi-cli.cjs')] };
    const settings = await evaluate('window.workbench.fetchSnapshot().then(snapshot => snapshot.settings)');
    await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { ...settings.agents, pi: command } })})`);
    const created = await evaluate(
      `window.workbench.createProject(${JSON.stringify({
        name: 'pi extension panels',
        directory,
        total: 2,
        counts: { codex: 0, claude: 0, pi: 2 },
      })})`,
    );
    await click(created.project.name);
    const runs = created.launches.map(launch => launch.run);
    const check = require('./support/status-display.cjs')({ evaluate, until });
    async function emit(run, payload, options = {}) {
      await evaluate(
        `window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id: payload.type, payload, ...options }) + '\n')})`,
      );
    }
    for (const run of runs) await check(run, 'ready');
    await emit(runs[0], { type: 'agent_start' });
    await check(runs[0], 'busy');
    await check(runs[1], 'ready');
    await emit(runs[0], { type: 'ui_prompt_start' });
    await check(runs[0], 'needs-input');
    await emit(runs[0], { type: 'tool_execution_end', isError: true });
    await check(runs[0], 'needs-input');
    const snapshot = await evaluate('window.workbench.fetchSnapshot()');
    assert.deepEqual(showing(snapshot, created.project.id, 'needs-input'), [[runs[0].panelId, runs[0].id]]);
    await emit(runs[1], { type: 'agent_start' });
    await emit(runs[1], { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } });
    await emit(runs[1], { type: 'agent_end' });
    await check(runs[1], 'busy');
    await emit(runs[1], { type: 'agent_settled' });
    await check(runs[1], 'done');
    await check(runs[0], 'needs-input');
    for (let i = 0; i < 2; i++) {
      await emit(runs[1], { type: 'session_before_compact', reason: 'manual' }, { idle: false });
      await check(runs[1], 'busy');
    }
    await emit(runs[1], { type: 'session_compact', reason: 'manual', willRetry: false }, { idle: false });
    await check(runs[1], 'busy');
    await emit(runs[1], { type: 'session_compact', reason: 'manual', willRetry: false }, { idle: true });
    await check(runs[1], 'done');
    await check(runs[0], 'needs-input');
    const compacted = await evaluate('window.workbench.fetchSnapshot()');
    assert.deepEqual(showing(compacted, created.project.id, 'done'), [[runs[1].panelId, runs[1].id]]);
    await emit(runs[0], { type: 'ui_prompt_end' });
    await check(runs[0], 'busy');
    await emit(runs[0], { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } });
    await emit(runs[0], { type: 'agent_settled' });
    await check(runs[0], 'error');
    await evaluate(`document.querySelector('[data-panel-id="${runs[0].panelId}"] .xterm-helper-textarea').focus()`);
    for (const character of JSON.stringify({ id: 'keyboard', payload: { type: 'agent_start' } })) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    }
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await check(runs[0], 'busy');
    await check(runs[1], 'done');
    console.log(
      'pi extensions preserve terminal input and consistent panel, navigation and Workbench membership across parallel runs.',
    );
  },
};
