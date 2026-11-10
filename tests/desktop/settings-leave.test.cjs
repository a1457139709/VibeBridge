const assert = require('node:assert/strict');
const { mkdir, readFile, rename, rm } = require('node:fs/promises');
const { runsOf } = require('./support/panel-views.cjs');

module.exports = {
  async run(context) {
    const { evaluate, until, click, fill, directory } = context;
    const f = await require('./support/summary.cjs')(context);
    const [first, second, third] = f.runs;
    const before = await f.snapshot();
    const settingsVisible = () => evaluate('!!document.querySelector(".settings-page")');
    const command = before.settings.agents.codex.command;
    const leaveDialog = () => evaluate('!!document.querySelector(".settings-leave[open]")');
    // The project summary lives in the workspace, so the settings page locates panels from project navigation.
    const locate = run => evaluate(`document.querySelector('[data-locate-panel-id="${run.panelId}"]').click()`);
    const navigationStatus = run => evaluate(`document.querySelector('[data-locate-panel-id="${run.panelId}"] .processing-status')?.getAttribute('aria-label')`);
    const assertDrafts = async expectedCommand => {
      await click('Agent'); assert.equal(await evaluate('document.getElementById("command-codex").value'), expectedCommand);
      await click('Appearance'); assert.ok(await evaluate('document.querySelector("input[value=dark]").checked'));
      await click('Keyboard shortcuts'); assert.equal(await evaluate('document.getElementById("shortcut-nextPanel").getAttribute("data-hint")'), 'Command+K');
    };
    await click('Global settings'); await click('Agent');
    await fill('command-codex', `${command}-draft`);
    await click('Appearance'); await evaluate('document.querySelector("input[value=dark]").click()');
    await click('Keyboard shortcuts');
    await evaluate('document.getElementById("shortcut-nextPanel").dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }))');

    assert.equal(await evaluate('!!document.querySelector(".project-summary")'), false, 'the settings page shows no project summary');
    await f.send(third, { payload: { hook_event_name: 'Stop' } });
    await until(async () => await navigationStatus(third) === 'Done', 'navigation shows Done for the third panel');
    assert.equal(await evaluate('!!document.querySelector(".project-summary")'), false);
    assert.equal(await leaveDialog(), false);
    await assertDrafts(`${command}-draft`);
    assert.deepEqual((await f.snapshot()).settings, before.settings);

    await locate(first);
    await until(leaveDialog, 'leave-settings dialog opened'); await click('Cancel');
    assert.ok(await settingsVisible()); await assertDrafts(`${command}-draft`);
    await click('Agent'); await fill('command-codex', '');
    await locate(first); await until(leaveDialog, 'leave-settings dialog opened'); await click('Save and return');
    await until(() => evaluate('document.getElementById("command-codex")?.getAttribute("aria-invalid") === "true"'), 'empty Codex command marked invalid');
    assert.ok(await settingsVisible()); await assertDrafts('');
    assert.deepEqual((await f.snapshot()).settings, before.settings);

    await click('Agent'); await fill('command-codex', command);
    // A valid Agent draft changes a future launch argument without restarting
    // existing runs. All three dirty categories must commit together.
    const argumentsDraft = [...before.settings.agents.codex.args, '--saved-draft'].join('\n');
    await evaluate(`(() => { const input = document.getElementById('arguments-codex');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(argumentsDraft)});
      input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const originalFile = await readFile(`${directory}/settings.json`, 'utf8');
    await rename(`${directory}/settings.json`, `${directory}/settings.backup`);
    await mkdir(`${directory}/settings.json`);
    try {
      await locate(first); await until(leaveDialog, 'leave-settings dialog opened'); await click('Save and return');
      await until(() => evaluate('document.querySelector(".settings-page [role=alert]")?.textContent.includes("Could not save settings")'), 'settings page shows the save failure');
      assert.ok(await settingsVisible());
      assert.deepEqual((await f.snapshot()).settings, before.settings);
      await assertDrafts(command);
      await click('Agent'); assert.equal(await evaluate('document.getElementById("arguments-codex").value'), argumentsDraft);
      assert.equal(await readFile(`${directory}/settings.backup`, 'utf8'), originalFile);
    } finally {
      await rm(`${directory}/settings.json`, { recursive: true });
      await rename(`${directory}/settings.backup`, `${directory}/settings.json`);
    }
    await locate(second); await until(leaveDialog, 'leave-settings dialog opened'); await click('Save and return');
    await until(async () => !(await settingsVisible()), 'settings page closed after saving');
    await f.receiveInput(second, 'saved-settings-selection');
    const saved = await f.snapshot();
    const expected = { ...before.settings, agents: { ...before.settings.agents, codex: { command, args: [...before.settings.agents.codex.args, '--saved-draft'] } },
      theme: 'dark', shortcuts: { ...before.settings.shortcuts, nextPanel: 'Command+K' } };
    assert.deepEqual(saved.settings, expected);
    assert.deepEqual(JSON.parse(await readFile(`${directory}/settings.json`, 'utf8')), expected);
    assert.deepEqual(runsOf(saved).map(run => [run.id, run.pid]), runsOf(before).map(run => [run.id, run.pid]));

    await click('Global settings'); await click('Agent'); await fill('command-codex', 'discard-this-draft');
    await locate(first); await until(leaveDialog, 'leave-settings dialog opened'); await click('Don’t save');
    await f.receiveInput(first, 'discarded-settings-selection');
    assert.deepEqual((await f.snapshot()).settings, expected);
    await click('Global settings'); await click('Agent'); assert.equal(await evaluate('document.getElementById("command-codex").value'), command);

    // The selected panel can disappear while the confirmation is open. A
    // successful settings decision must never retarget input to a survivor.
    await fill('command-codex', 'another-discarded-draft');
    await locate(third); await until(leaveDialog, 'leave-settings dialog opened');
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(third.panelId)})`);
    await click('Don’t save');
    await until(async () => !(await settingsVisible()), 'settings page closed after discarding');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'), false);
    assert.equal(await evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'), false);
    await f.choose('done', second); await f.receiveInput(second, 'explicit-selection-after-disappearance');

    // Disappearance while waiting for a real terminal must also cancel without
    // focusing the fallback panel chosen only for display.
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = 'none'`);
    await f.choose('done', first);
    await until(() => evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'), 'locating waits for the hidden first terminal');
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(first.panelId)})`);
    await until(() => evaluate('!document.querySelector(".workbench-page").classList.contains("locating-panel")'), 'locating ended when the target panel closed');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'), false);
    await f.choose('done', second); await f.receiveInput(second, 'explicit-selection-after-cancel');
    const added = await evaluate(`window.workbench.addPanel(${JSON.stringify(f.projectId)}, 'codex')`);
    await f.send(added.launch.run, { payload: { hook_event_name: 'Stop' } });
    await f.choose('done', added.launch.run); await f.receiveInput(added.launch.run, 'before-live-exit');
    await f.open('done');
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(added.panel.id)})`);
    await until(() => evaluate('document.querySelectorAll(".summary-list li").length === 1'), 'summary list dropped the closed panel');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('!!document.activeElement.closest(".summary-list")'), 'a background exit cannot steal keyboard focus from an open list');
    await click('Close panel list');
    await f.choose('done', second); await f.receiveInput(second, 'after-live-list-update');
    console.log('Settings without a summary, leave-to-locate cancel, validation, real failed write/retry, whole-draft save, discard and disappearing targets passed.');
  },
};
