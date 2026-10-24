const assert = require('node:assert/strict');
const { resolve } = require('node:path');

module.exports = {
  async run(context) {
    const { evaluate, until } = context;
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/codex-hooks.cjs')] };
    const settings = await evaluate('window.workbench.snapshot().then(snapshot => snapshot.settings)');
    await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { ...settings.agents, codex: command } })})`);
    const created = await require('./support/project.cjs')(context, 'Codex hook panels');
    const project = created.activeProjectId;
    await evaluate(`window.workbench.addPanel(${JSON.stringify(project)}, 'codex')`);
    const runs = (await evaluate('window.workbench.snapshot()')).runs;
    assert.equal(runs.length, 2);
    const label = (run, selector) => `document.querySelector('[${selector}="${run.panelId}"] .processing-status')?.getAttribute('aria-label')`;
    async function check(run, expected) {
      await until(() => evaluate(`${label(run, 'data-panel-id')} === ${JSON.stringify(expected)}`));
      assert.equal(await evaluate(label(run, 'data-locate-panel-id')), expected);
    }
    for (const run of runs) await check(run, 'Ready');
    async function emit(run, payload) {
      await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id: payload.hook_event_name, payload }) + '\n')})`);
    }
    await emit(runs[0], { hook_event_name: 'UserPromptSubmit', turn_id: 'first' });
    await check(runs[0], 'Busy'); await check(runs[1], 'Ready');
    await emit(runs[0], { hook_event_name: 'PermissionRequest', turn_id: 'first', tool_use_id: 'approval', tool_name: 'Bash' });
    await check(runs[0], 'Needs input');
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(snapshot.processing.projects[project]['needs-input'], { count: 1, members: [{ panelId: runs[0].panelId, runId: runs[0].id }] });
    await emit(runs[1], { hook_event_name: 'UserPromptSubmit', turn_id: 'second' });
    await emit(runs[1], { hook_event_name: 'Stop', turn_id: 'second' });
    await check(runs[1], 'Done'); await check(runs[0], 'Needs input');
    await emit(runs[0], { hook_event_name: 'PostToolUse', turn_id: 'first', tool_use_id: 'approval', tool_name: 'Bash' });
    await check(runs[0], 'Busy');
    const needsInputEntry = count => `document.querySelector('.summary-entry[aria-label="${count} Needs input"]')`;
    await emit(runs[0], { hook_event_name: 'PreToolUse', turn_id: 'first', tool_use_id: 'question', tool_name: 'request_user_input' });
    await check(runs[0], 'Needs input'); await check(runs[1], 'Done');
    await until(() => evaluate(`${needsInputEntry(1)}?.disabled === false`));
    await evaluate(`${needsInputEntry(1)}.click()`);
    await until(() => evaluate('!!document.querySelector(".summary-list")'));
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".summary-list [data-run-id]")].map(item => item.dataset.runId)'), [runs[0].id]);
    await evaluate(`${needsInputEntry(1)}.click()`);
    await emit(runs[0], { hook_event_name: 'PostToolUse', turn_id: 'first', tool_use_id: 'question', tool_name: 'request_user_input' });
    await check(runs[0], 'Busy');
    await until(() => evaluate(`${needsInputEntry(0)}?.disabled === true`));
    console.log('Production Codex hook launch and reporter drive matching panel/navigation/summary states with isolated same-directory runs.');
  },
};
