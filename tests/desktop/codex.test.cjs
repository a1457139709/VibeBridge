const assert = require('node:assert/strict');

// Opt-in compatibility check with the locally installed Codex. Never submits a
// prompt or resumes a session; only exercises the native picker's filter control.

module.exports = {
  manual: 'Requires locally installed Codex and local CLI history.',
  configure: settings => ({ ...settings, agents: { ...settings.agents,
    codex: { command: 'codex', args: ['resume', '--no-daemon', '--no-alt-screen'] } } }),
  async run({ window, evaluate, click, fill, until, directory }) {
    await until(() => evaluate(`!!document.getElementById('project-directory')`));
    await fill('project-directory', directory);
    await fill('project-name', 'Codex compatibility');
    await click('减少窗口数量');
    await click('增加Codex');
    await click('增加pi');
    await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
    await click('创建并启动');
    await until(() => evaluate(`document.querySelector('.panel-slot.codex .xterm-rows')?.textContent.includes('Resume a previous session')`));
    const selectedFilter = () => evaluate(`(() => {
      const row = [...document.querySelectorAll('.panel-slot.codex .xterm-rows > div')].find(row => row.textContent.includes('Filter:'));
      return [...row.querySelectorAll('span')].filter(span => getComputedStyle(span).fontWeight === '700').map(span => span.textContent).join('');
    })()`);
    const key = keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    };
    const check = async () => {
      assert.equal(await evaluate(`document.activeElement?.closest('[data-panel-id]')?.classList.contains('codex')`), true);
      assert.match(await selectedFilter(), /Cwd/);
      key('Right');
      await until(async () => /All/.test(await selectedFilter()));
      key('Left');
      await until(async () => /Cwd/.test(await selectedFilter()));
    };
    window.focus(); window.webContents.focus();
    await check();
    await evaluate(`document.querySelector('.panel-slot.pi .panel-header').click()`);
    await evaluate(`document.querySelector('.panel-slot.codex .panel-header').click()`);
    await check();
    await click('全局设置');
    await click('‹ 返回');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.classList.contains('codex')`));
    await check();
    await click('添加项目');
    await click('取消');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.classList.contains('codex')`));
    await check();
    return { afterQuit: () => console.log('Codex native resume picker arrows, focus changes and quit passed.') };
  },
};
