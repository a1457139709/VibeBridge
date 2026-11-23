const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { runsOf, showing } = require('./support/panel-views.cjs');
const { summaryEntry, entryLabel } = require('./support/summary-entries.cjs');

module.exports = {
  async run(context) {
    const { evaluate, until } = context;
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/codex-cli.cjs')] };
    const settings = await evaluate('window.workbench.fetchSnapshot().then(snapshot => snapshot.settings)');
    await evaluate(
      `window.workbench.saveSettings(${JSON.stringify({ agents: { ...settings.agents, codex: command } })})`,
    );
    const created = await require('./support/project.cjs')(context, 'Codex hook panels', { Codex: 2 });
    const project = created.activeProjectId;
    const runs = runsOf(await evaluate('window.workbench.fetchSnapshot()'));
    assert.equal(runs.length, 2);
    const check = require('./support/status-display.cjs')(context);
    for (const run of runs) await check(run, 'ready');
    async function emit(run, payload) {
      await evaluate(
        `window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id: payload.hook_event_name, payload }) + '\n')})`,
      );
    }
    await emit(runs[0], { hook_event_name: 'UserPromptSubmit', turn_id: 'first' });
    await check(runs[0], 'busy');
    await check(runs[1], 'ready');
    await emit(runs[0], {
      hook_event_name: 'PermissionRequest',
      turn_id: 'first',
      tool_use_id: 'approval',
      tool_name: 'Bash',
    });
    await check(runs[0], 'needs-input');
    const snapshot = await evaluate('window.workbench.fetchSnapshot()');
    assert.deepEqual(showing(snapshot, project, 'needs-input'), [[runs[0].panelId, runs[0].id]]);
    await emit(runs[1], { hook_event_name: 'UserPromptSubmit', turn_id: 'second' });
    await emit(runs[1], { hook_event_name: 'Stop', turn_id: 'second' });
    await check(runs[1], 'done');
    await check(runs[0], 'needs-input');
    await emit(runs[0], {
      hook_event_name: 'PostToolUse',
      turn_id: 'first',
      tool_use_id: 'approval',
      tool_name: 'Bash',
    });
    await check(runs[0], 'busy');
    const needsInputEntry = summaryEntry('needs-input');
    const entryShows = (count, disabled) =>
      evaluate(`(entry => entry?.disabled === ${disabled}
        && entry.getAttribute('aria-label') === ${JSON.stringify(entryLabel('needs-input', count))})(${needsInputEntry})`);
    await emit(runs[0], {
      hook_event_name: 'PreToolUse',
      turn_id: 'first',
      tool_use_id: 'question',
      tool_name: 'request_user_input',
    });
    await check(runs[0], 'needs-input');
    await check(runs[1], 'done');
    await until(() => entryShows(1, false), 'needs-input summary entry counts 1 and is enabled');
    await evaluate(`${needsInputEntry}.click()`);
    await until(() => evaluate('!!document.querySelector(".summary-list")'), 'Needs input summary list opened');
    assert.deepEqual(
      await evaluate('[...document.querySelectorAll(".summary-list [data-run-id]")].map(item => item.dataset.runId)'),
      [runs[0].id],
    );
    await evaluate(`${needsInputEntry}.click()`);
    await emit(runs[0], {
      hook_event_name: 'PostToolUse',
      turn_id: 'first',
      tool_use_id: 'question',
      tool_name: 'request_user_input',
    });
    await check(runs[0], 'busy');
    await until(() => entryShows(0, true), 'needs-input summary entry counts 0 and is disabled');
    console.log(
      'Production Codex hook launch and reporter drive matching panel/navigation/summary states with isolated same-directory runs.',
    );
  },
};
