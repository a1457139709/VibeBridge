const assert = require('node:assert/strict');
module.exports = async function verifyConflicts({ window, evaluate, click, until }) {
  const before = (await evaluate('window.workbench.snapshot()')).settings.shortcuts;
  await click('全局设置'); await click('快捷键');
  const record = async (action, keyCode, modifiers = ['meta']) => {
    const binding = `Command+${keyCode}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      await evaluate(`document.getElementById('shortcut-${action}').focus()`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      const applied = await until(() => evaluate(`document.getElementById('shortcut-${action}').title === '${binding}'`), 1000)
        .then(() => true, () => false);
      if (applied) return;
    }
    throw new Error(`Recording ${binding} for ${action} did not take effect`);
  };
  await record('previousProject', 'K');
  await record('nextProject', 'K');
  await record('maximizePanel', 'L');
  await record('addPanel', 'C');
  await record('settings', 'K');
  await until(() => evaluate(`document.getElementById('shortcut-settings').title === 'Command+K'`));
  assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), false, 'recording settings shortcut cannot navigate');
  const first = await evaluate(`document.getElementById('shortcut-previousProject').getAttribute('aria-invalid')`);
  assert.equal(first, 'true', 'valid conflicting bindings remain highlighted in draft');
  const colors = await evaluate(`Object.fromEntries(['previousProject','nextProject','nextPanel','settings','maximizePanel','previousPanel','addPanel'].map(action => [action, getComputedStyle(document.getElementById('shortcut-' + action)).borderColor]))`);
  assert.equal(colors.previousProject, colors.nextProject); assert.equal(colors.nextProject, colors.nextPanel); assert.equal(colors.settings, colors.nextPanel);
  assert.equal(colors.maximizePanel, colors.previousPanel); assert.notEqual(colors.maximizePanel, colors.nextPanel); assert.notEqual(colors.addPanel, colors.nextPanel);
  assert.match(await evaluate(`document.getElementById('shortcut-previousProject').closest('.shortcut-row').textContent`), /切换到下一个项目.*切换到下一个面板.*打开全局设置/);
  assert.match(await evaluate(`document.getElementById('shortcut-addPanel').closest('.shortcut-row').textContent`), /系统.*复制/);
  await click('保存');
  await until(() => evaluate(`document.querySelector('.settings-status').textContent.includes('存在按键冲突，未保存')`));
  assert.match(await evaluate(`document.querySelector('.settings-page').textContent`), /存在按键冲突，未保存/);
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).settings.shortcuts, before);
  await click('‹ 返回'); await click('保存并返回');
  await until(() => evaluate(`!document.querySelector('dialog[open]') && !document.querySelector('.settings-save .primary').disabled`));
  assert.ok(await evaluate(`!!document.querySelector('.settings-page')`));
  await click('放弃更改');
  assert.equal(await evaluate(`document.getElementById('shortcut-nextPanel').title`), 'Command+K');
  assert.equal(await evaluate(`document.querySelectorAll('.shortcut-row input[aria-invalid="true"]').length`), 0);
  await click('恢复默认设置');
  assert.equal(await evaluate(`document.getElementById('shortcut-nextPanel').title`), 'Command+]');
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).settings.shortcuts, before, 'defaults remain draft until save');
  await click('放弃更改'); await click('‹ 返回');
  await until(() => evaluate(`!document.querySelector('.settings-page')`));
};
