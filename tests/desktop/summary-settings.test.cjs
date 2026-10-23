const assert = require('node:assert/strict');
const { mkdir, readFile, rename, rm } = require('node:fs/promises');

module.exports = {
  async run(context) {
    const { evaluate, until, click, fill, directory } = context;
    const f = await require('./support/summary.cjs')(context);
    const [first, second, third] = f.runs;
    const before = await f.snapshot();
    const settingsVisible = () => evaluate('!!document.querySelector(".settings-page")');
    const command = before.settings.agents.codex.command;
    const leaveDialog = () => evaluate('!!document.querySelector(".settings-leave[open]")');
    const assertDrafts = async expectedCommand => {
      await click('Agent'); assert.equal(await evaluate('document.getElementById("command-codex").value'), expectedCommand);
      await click('外观'); assert.ok(await evaluate('document.querySelector("input[value=dark]").checked'));
      await click('快捷键'); assert.equal(await evaluate('document.getElementById("shortcut-nextPanel").getAttribute("title")'), 'Command+K');
    };
    await click('全局设置');
    await fill('command-codex', `${command}-draft`);
    await click('外观'); await evaluate('document.querySelector("input[value=dark]").click()');
    await click('快捷键');
    await evaluate('document.getElementById("shortcut-nextPanel").dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: true, bubbles: true }))');

    await f.open('done');
    assert.equal(await leaveDialog(), false);
    await f.send(third, { payload: { hook_event_name: 'Stop' } });
    await until(() => evaluate('document.querySelectorAll(".summary-list li").length === 3'));
    assert.ok(await evaluate('[...document.querySelectorAll(".summary-entry")].some(button => button.textContent === "3 Done")'));
    assert.equal(await leaveDialog(), false);
    await click('Close panel list');
    await assertDrafts(`${command}-draft`);
    assert.deepEqual((await f.snapshot()).settings, before.settings);

    await f.choose('done', first);
    await until(leaveDialog); await click('取消');
    assert.ok(await settingsVisible()); await assertDrafts(`${command}-draft`);
    await click('Agent'); await fill('command-codex', '');
    await f.choose('done', first); await until(leaveDialog); await click('保存并返回');
    await until(() => evaluate('document.getElementById("command-codex")?.getAttribute("aria-invalid") === "true"'));
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
      await f.choose('done', first); await until(leaveDialog); await click('保存并返回');
      await until(() => evaluate('document.querySelector(".settings-page [role=alert]")?.textContent.includes("配置保存失败")'));
      assert.ok(await settingsVisible());
      assert.deepEqual((await f.snapshot()).settings, before.settings);
      await assertDrafts(command);
      await click('Agent'); assert.equal(await evaluate('document.getElementById("arguments-codex").value'), argumentsDraft);
      assert.equal(await readFile(`${directory}/settings.backup`, 'utf8'), originalFile);
    } finally {
      await rm(`${directory}/settings.json`, { recursive: true });
      await rename(`${directory}/settings.backup`, `${directory}/settings.json`);
    }
    await f.choose('done', second); await until(leaveDialog); await click('保存并返回');
    await until(async () => !(await settingsVisible()));
    await f.receiveInput(second, 'saved-settings-selection');
    const saved = await f.snapshot();
    const expected = { ...before.settings, agents: { ...before.settings.agents, codex: { command, args: [...before.settings.agents.codex.args, '--saved-draft'] } },
      theme: 'dark', shortcuts: { ...before.settings.shortcuts, nextPanel: 'Command+K' } };
    assert.deepEqual(saved.settings, expected);
    assert.deepEqual(JSON.parse(await readFile(`${directory}/settings.json`, 'utf8')), expected);
    assert.deepEqual(saved.runs.map(run => [run.id, run.pid]), before.runs.map(run => [run.id, run.pid]));

    await click('全局设置'); await fill('command-codex', 'discard-this-draft');
    await f.choose('done', first); await until(leaveDialog); await click('不保存');
    await f.receiveInput(first, 'discarded-settings-selection');
    assert.deepEqual((await f.snapshot()).settings, expected);
    await click('全局设置'); assert.equal(await evaluate('document.getElementById("command-codex").value'), command);

    // The selected panel can disappear while the confirmation is open. A
    // successful settings decision must never retarget input to a survivor.
    await fill('command-codex', 'another-discarded-draft');
    await f.choose('done', third); await until(leaveDialog);
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(third.panelId)})`);
    await click('不保存');
    await until(async () => !(await settingsVisible()));
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'), false);
    assert.equal(await evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'), false);
    await f.choose('done', second); await f.receiveInput(second, 'explicit-selection-after-disappearance');

    // Disappearance while waiting for a real terminal must also cancel without
    // focusing the fallback panel chosen only for display.
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = 'none'`);
    await f.choose('done', first);
    await until(() => evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'));
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(first.panelId)})`);
    await until(() => evaluate('!document.querySelector(".workbench-page").classList.contains("locating-panel")'));
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.equal(await evaluate('document.activeElement?.classList.contains("xterm-helper-textarea")'), false);
    await f.choose('done', second); await f.receiveInput(second, 'explicit-selection-after-cancel');
    const added = await evaluate(`window.workbench.addPanel(${JSON.stringify(f.projectId)}, 'codex')`);
    await f.send(added.launch.run, { payload: { hook_event_name: 'Stop' } });
    await f.choose('done', added.launch.run); await f.receiveInput(added.launch.run, 'before-live-exit');
    await f.open('done');
    await evaluate(`window.workbench.closePanel(${JSON.stringify(f.projectId)}, ${JSON.stringify(added.panel.id)})`);
    await until(() => evaluate('document.querySelectorAll(".summary-list li").length === 1'));
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.ok(await evaluate('!!document.activeElement.closest(".summary-list")'), 'a background exit cannot steal keyboard focus from an open list');
    await click('Close panel list');
    await f.choose('done', second); await f.receiveInput(second, 'after-live-list-update');
    console.log('Live settings summary, cancel, validation, real failed write/retry, whole-draft save, discard and disappearing targets passed.');
  },
};
