const assert = require('node:assert/strict');

module.exports = {
  async run({ window, evaluate, click, fill, until }) {
    await until(() => evaluate(`!!document.getElementById('project-name')`));
    const before = (await evaluate('window.workbench.snapshot()')).settings;
    await click('全局设置');
    await fill('command-codex', ''); await fill('command-pi', '');
    await click('快捷键');
    await evaluate(`document.getElementById('shortcut-nextPanel').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'N', modifiers: ['meta'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'N', modifiers: ['meta'] });
    await until(() => evaluate(`document.getElementById('shortcut-nextPanel').title === 'Command+N'`));
    await click('外观'); await evaluate(`document.querySelector('input[value="dark"]').click()`);
    await click('保存');
    await until(() => evaluate(`!document.querySelector('.settings-save .primary').disabled`));
    const partial = (await evaluate('window.workbench.snapshot()')).settings;
    assert.deepEqual(partial, { ...before, theme: 'dark' }, 'ordinary save excludes every other category draft');
    await click('‹ 返回'); await click('保存并返回');
    await until(() => evaluate(`!document.querySelector('dialog[open]') && !document.querySelector('.settings-save .primary').disabled`));
    assert.equal(await evaluate(`document.querySelector('[aria-label="设置分类"] [aria-current="page"]').textContent`), 'Agent', 'first problem follows category navigation order');
    await until(() => evaluate(`document.activeElement.id === 'command-codex'`));
    assert.equal(await evaluate(`document.querySelectorAll('.agent-settings input[aria-invalid="true"]').length`), 2);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).settings, partial);
    await fill('command-codex', before.agents.codex.command); await fill('command-pi', before.agents.pi.command);
    await click('快捷键');
    assert.equal(await evaluate(`document.querySelectorAll('.shortcut-row input[aria-invalid="true"]').length`), 2);
    await click('恢复默认设置');
    await click('‹ 返回');
    await until(() => evaluate(`!document.querySelector('.settings-page')`));
    await click('全局设置'); await click('外观');
    assert.equal(await evaluate(`document.querySelector('input[value="dark"]').checked`), true);

    // Hold the public Electron boundary to observe in-flight UI protection.
    const { ipcMain } = require('electron');
    const requests = [];
    ipcMain.removeHandler('workbench:settings');
    ipcMain.handle('workbench:settings', () => new Promise((_resolve, reject) => requests.push(reject)));
    await click('Agent'); await fill('command-codex', '/pending-draft');
    await evaluate(`document.querySelectorAll('.notice button').forEach(button => button.click())`);
    await click('保存'); await until(() => requests.length === 1);
    assert.equal(await evaluate(`document.querySelector('.settings-scroll fieldset').disabled`), true);
    assert.equal(await evaluate(`[...document.querySelectorAll('.settings-save button, .settings-navigation button, .settings-back')].every(button => button.disabled)`), true);
    await click('全局设置'); await click('添加项目');
    await evaluate(`document.querySelector('.settings-content form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`);
    assert.equal(requests.length, 1);
    assert.equal(await evaluate(`!!document.querySelector('.settings-page') && !document.querySelector('dialog[open]')`), true);
    requests[0](new Error('transport-specific failure'));
    await until(() => evaluate(`document.querySelector('.settings-status').textContent === '设置暂时无法保存，请稍后重试'`));
    assert.equal(await evaluate(`document.getElementById('command-codex').value`), '/pending-draft');
    assert.equal(await evaluate(`!!document.querySelector('.notice.success')`), false);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).settings, partial);
  },
};
