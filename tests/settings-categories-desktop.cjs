const assert = require('node:assert/strict');
const { mkdir, rename, rm } = require('node:fs/promises');

module.exports = async function verifyCategories({ window, evaluate, click, fill, until, directory }) {
  const screenshot = require('./desktop-evidence.cjs')(window);
  const before = await evaluate('window.workbench.snapshot()');
  const saved = () => evaluate('window.workbench.snapshot().then(state => state.settings)');
  const command = type => evaluate(`document.getElementById('command-${type}').value`);
  const binding = () => evaluate(`document.getElementById('shortcut-addPanel').title`);
  const theme = () => evaluate(`document.querySelector('input[name="theme"]:checked').value`);
  const setTheme = value => evaluate(`document.querySelector('input[value="${value}"]').click()`);
  const record = async keyCode => {
    await evaluate(`document.getElementById('shortcut-addPanel').focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['meta', 'shift'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['meta', 'shift'] });
    await until(() => evaluate(`document.getElementById('shortcut-addPanel').title === 'Command+Shift+${keyCode}'`));
  };
  await click('全局设置');
  for (const type of ['codex', 'claude', 'pi']) await fill(`command-${type}`, `/saved-${type}`);
  await click('保存');
  await until(async () => (await saved()).agents.pi.command === '/saved-pi');
  await click('外观'); await setTheme('dark'); await click('保存');
  await until(async () => (await saved()).theme === 'dark');
  await click('快捷键'); await record('Y'); await click('保存');
  await until(async () => (await saved()).shortcuts.addPanel === 'Command+Shift+Y');
  const baseline = await saved();
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'light');
  await click('Agent');
  for (const type of ['codex', 'claude', 'pi']) await fill(`command-${type}`, `/draft-${type}`);
  await click('外观'); await setTheme('light');
  await click('快捷键'); await record('J');

  for (const category of ['Agent', '外观', '快捷键']) {
    await click(category);
    await evaluate(`document.querySelectorAll('.notice button').forEach(button => button.click())`);
    await screenshot(`settings-${category}-draft`);
    await click('恢复默认设置');
    assert.deepEqual(await saved(), baseline, 'Restoring defaults changes no saved category');
    if (category === 'Agent') for (const type of ['codex', 'claude', 'pi']) assert.equal(await command(type), type);
    if (category === '外观') assert.equal(await theme(), 'system');
    if (category === '快捷键') assert.equal(await binding(), 'Command+N');
    await screenshot(`settings-${category}-defaults`);
    await click('放弃更改');
    if (category === 'Agent') for (const type of ['codex', 'claude', 'pi']) assert.equal(await command(type), `/saved-${type}`);
    if (category === '外观') assert.equal(await theme(), 'dark');
    if (category === '快捷键') assert.equal(await binding(), 'Command+Shift+Y');
    // Re-establish three distinct drafts before exercising the next category.
    await click('Agent');
    if (category !== 'Agent') assert.equal(await command('codex'), '/draft-codex');
    for (const type of ['codex', 'claude', 'pi']) await fill(`command-${type}`, `/draft-${type}`);
    await click('外观'); if (category !== '外观') assert.equal(await theme(), 'light'); await setTheme('light');
    await click('快捷键'); if (category !== '快捷键') assert.equal(await binding(), 'Command+Shift+J'); await record('J');
  }

  let effective = baseline;
  for (const category of ['Agent', '外观', '快捷键']) {
    await click(category);
    await rename(`${directory}/settings.json`, `${directory}/category-backup.json`);
    await mkdir(`${directory}/settings.json`);
    try {
      await evaluate(`document.querySelectorAll('.notice button').forEach(button => button.click())`);
      await click('保存');
      await until(() => evaluate(`document.querySelector('.settings-status').textContent.includes('配置保存失败')`));
      assert.deepEqual(await saved(), effective, 'A real disk failure leaves the saved baseline unchanged');
      assert.equal(await evaluate(`!!document.querySelector('.notice.success')`), false);
    } finally {
      await rm(`${directory}/settings.json`, { recursive: true });
      await rename(`${directory}/category-backup.json`, `${directory}/settings.json`);
    }
    await click('保存');
    await until(() => evaluate(`!document.querySelector('.settings-save .primary').disabled && !document.querySelector('.settings-status').textContent`));
    const next = await saved();
    assert.deepEqual(next, category === 'Agent' ? { ...effective, agents: Object.fromEntries(['codex', 'claude', 'pi'].map(type => [type, { ...effective.agents[type], command: `/draft-${type}` }])) }
      : category === '外观' ? { ...effective, theme: 'light' } : { ...effective, shortcuts: { ...effective.shortcuts, addPanel: 'Command+Shift+J' } });
    effective = next;
    await click('恢复默认设置'); await click('放弃更改');
    if (category === 'Agent') assert.equal(await command('codex'), '/draft-codex');
    if (category === '外观') assert.equal(await theme(), 'light');
    if (category === '快捷键') assert.equal(await binding(), 'Command+Shift+J');
  }
  await click('‹ 返回'); await click('全局设置');
  assert.equal(await command('codex'), '/draft-codex', 'Reentering uses the latest successful save');
  await fill('command-codex', ''); await click('保存');
  await until(() => evaluate(`document.activeElement.id === 'command-codex'`));
  await click('放弃更改');
  assert.equal(await evaluate(`!!document.querySelector('input[aria-invalid="true"]')`), false);
  assert.equal(await evaluate(`document.querySelector('.settings-status').textContent`), '');
  await click('‹ 返回');
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, before.runs, 'Cross-category edits never restart current Agents');
  await evaluate(`window.workbench.saveSettings(${JSON.stringify(before.settings)})`);
  console.log('Three-category defaults/discard/save isolation, updated saved baselines, real disk failures and uninterrupted runs passed.');
};
