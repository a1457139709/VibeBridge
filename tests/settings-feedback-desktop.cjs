const assert = require('node:assert/strict');
const { mkdir, symlink } = require('node:fs/promises');

module.exports = async function verifyFeedback({ window, evaluate, click, fill, until, directory }) {
  const screenshot = require('./desktop-evidence.cjs')(window);
  const before = (await evaluate('window.workbench.snapshot()')).settings;
  await click('全局设置');
  await evaluate(`document.querySelectorAll('.notice button').forEach(button => button.click())`);
  window.setSize(900, 650);
  for (const type of ['codex', 'claude', 'pi']) {
    await fill(`command-${type}`, 'node');
    await evaluate(`(() => { const input = document.getElementById('command-${type}'); input.scrollIntoView({ block: 'center' }); input.focus(); })()`);
    await screenshot(`settings-focus-${type}`);
    const contained = await evaluate(`(() => {
      const input = document.getElementById('command-${type}'), box = input.getBoundingClientRect(), viewport = document.querySelector('.settings-scroll').getBoundingClientRect();
      const style = getComputedStyle(input), ring = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
      return box.left - ring >= viewport.left && box.right + ring <= viewport.right && box.top - ring >= viewport.top && box.bottom + ring <= viewport.bottom;
    })()`);
    assert.ok(contained, `${type} focus ring fits inside the scrolled content viewport on all four sides`);
    await evaluate(`document.querySelector('.agent-settings.${type} button').click()`);
    await until(() => evaluate(`document.querySelector('.agent-settings.${type} .command-result').textContent.includes('命令可用')`));
    await screenshot(`settings-check-${type}`);
    await fill(`command-${type}`, '/unavailable-check-command');
    assert.equal(await evaluate(`document.querySelector('.agent-settings.${type} .command-result').textContent`), '');
    await evaluate(`document.querySelector('.agent-settings.${type} button').click()`);
    await until(() => evaluate(`document.querySelector('.agent-settings.${type} .command-result').textContent.includes('命令不可用')`));
  }
  const longDirectory = `${directory}/${'readable-long-command-result-'.repeat(5)}`;
  await mkdir(longDirectory);
  const executable = `${longDirectory}/node-command-with-a-long-readable-path`;
  await symlink(process.env.VIBEBRIDGE_TEST_NODE, executable);
  await fill('command-codex', executable);
  await evaluate(`document.getElementById('command-codex').scrollIntoView({ block: 'center' }); document.getElementById('command-codex').focus(); document.querySelector('.agent-settings.codex button').click()`);
  await until(() => evaluate(`document.querySelector('.agent-settings.codex .command-result').textContent.includes(${JSON.stringify(executable)})`));
  assert.equal(await evaluate(`(() => { const result = document.querySelector('.agent-settings.codex .command-result'); return result.scrollWidth <= result.clientWidth; })()`), true, 'Long check feedback wraps inside its readable field');
  await screenshot('settings-long-feedback');
  await click('放弃更改');
  for (const type of ['codex', 'claude', 'pi']) assert.equal(await evaluate(`document.querySelector('.agent-settings.${type} .command-result').textContent`), '');
  window.setSize(700, 580);
  await evaluate(`document.getElementById('command-codex').scrollIntoView({ block: 'center' }); document.getElementById('command-codex').focus()`);
  await screenshot('settings-narrow');
  for (const category of ['Agent', '外观', '快捷键']) {
    await click(category);
    assert.ok(await evaluate(`[...document.querySelectorAll('.settings-save button')].every(button => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top > 44 && r.bottom < innerHeight; })`), 'All category actions stay usable in a narrow window');
  }
  await click('Agent');
  // Control response timing at the public Electron command-check boundary. The
  // normal provider's real success/failure and long path were exercised above.
  const { ipcMain } = require('electron');
  const pendingChecks = [];
  ipcMain.removeHandler('workbench:check-command');
  ipcMain.handle('workbench:check-command', () => new Promise(resolve => pendingChecks.push(resolve)));
  for (const reset of ['放弃更改', '恢复默认设置']) {
    await fill('command-codex', '/old-command');
    await evaluate(`document.querySelector('.agent-settings.codex button').click()`);
    await until(() => pendingChecks.length === 1);
    await click(reset);
    const current = await evaluate(`document.getElementById('command-codex').value`);
    assert.equal(current, reset === '放弃更改' ? before.agents.codex.command : 'codex');
    await evaluate(`document.querySelector('.agent-settings.codex button').click()`);
    await until(() => pendingChecks.length === 2);
    pendingChecks.pop()({ available: true, path: '/current-command-result' });
    await until(() => evaluate(`document.querySelector('.agent-settings.codex .command-result').textContent.includes('/current-command-result')`));
    pendingChecks.shift()({ available: false, message: 'STALE-COMMAND-RESULT' });
    await evaluate('new Promise(resolve => setTimeout(resolve, 50))');
    assert.equal(await evaluate(`document.querySelector('.agent-settings.codex .command-result').textContent`), '命令可用：/current-command-result', 'A late discarded check cannot replace new-draft feedback');
  }
  await click('放弃更改'); await click('‹ 返回');
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).settings, before);
  window.setSize(1200, 800);
  console.log('Three Agent focus rings, scroll/narrow layout, explicit real command checks, long feedback and late discarded responses passed.');
};
