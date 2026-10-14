const assert = require('node:assert/strict');
const { mkdir, rename, rm } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ window, evaluate, click, fill, until, directory, first, second, locate }) => {
  const target = second.panels[0].id;
  const request = () => evaluate(`document.querySelector('[data-locate-panel-id="${target}"]').click()`);
  const dialog = () => until(() => evaluate(`!!document.querySelector('.settings-leave[open]')`));
  const baseline = await evaluate('window.workbench.snapshot()');
  const oldCommand = baseline.settings.agents.codex.command;
  await click('全局设置');
  await locate(target, 'x');
  assert.equal(await evaluate(`!!document.querySelector('.settings-page')`), false, 'A clean settings page can navigate directly to a panel');
  await locate(first.panels[1].id, 'y');
  const unchanged = async () => {
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.equal(snapshot.activeProjectId, first.id);
    assert.deepEqual(snapshot.projects, baseline.projects);
    assert.deepEqual(snapshot.runs, baseline.runs);
    assert.equal(await evaluate(`!!document.querySelector('.settings-page')`), true);
  };
  await click('全局设置'); await fill('command-codex', '');
  await request(); await dialog(); await click('取消');
  await until(() => evaluate(`!document.querySelector('.settings-leave[open]')`));
  await unchanged();
  assert.equal(await evaluate(`document.getElementById('command-codex').value`), '');
  await request(); await dialog(); await click('保存并返回');
  await until(() => evaluate(`document.getElementById('command-codex').getAttribute('aria-invalid') === 'true' && !document.querySelector('.settings-leave[open]')`));
  await unchanged();
  await fill('command-codex', process.env.VIBEBRIDGE_TEST_NODE);
  await rename(join(directory, 'settings.json'), join(directory, 'title-settings-backup.json'));
  await mkdir(join(directory, 'settings.json'));
  try {
    await request(); await dialog(); await click('保存并返回');
    await until(() => evaluate(`!document.querySelector('.settings-leave[open]') && !!document.querySelector('.settings-status [role="alert"]')`));
    await unchanged();
    assert.equal((await evaluate('window.workbench.snapshot()')).settings.agents.codex.command, oldCommand);
  } finally {
    await rm(join(directory, 'settings.json'), { recursive: true });
    await rename(join(directory, 'title-settings-backup.json'), join(directory, 'settings.json'));
  }
  await request(); await dialog(); await click('不保存');
  await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(target)}`));
  window.focus(); window.webContents.focus();
  window.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
  await until(() => evaluate(`window.titleOutput.some(event => event.data.includes('INPUT:z'))`));
  assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes('INPUT:z')).map(event => event.runId))]`), [baseline.runs.find(run => run.panelId === target).id]);
  assert.equal((await evaluate('window.workbench.snapshot()')).settings.agents.codex.command, oldCommand);
  await until(() => evaluate(`!document.querySelector('.locating-panel')`));
  await click('全局设置'); await click('外观');
  await evaluate(`(() => { const input = document.getElementById('default-layout'); input.value = 'row'; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').click()`);
  await dialog(); await click('保存并返回');
  await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(first.panels[0].id)}`));
  const saved = await evaluate('window.workbench.snapshot()');
  assert.equal(saved.settings.defaultLayout, 'row');
  assert.deepEqual(saved.projects, baseline.projects);
  assert.deepEqual(saved.runs, baseline.runs);
  console.log('PASS: panel locator uses one settings-leave guard for clean, cancel, invalid save, real file-write failure, discard and successful save; native input reaches only the accepted destination');
};
