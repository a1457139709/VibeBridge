const assert = require('node:assert/strict');

module.exports = async (context, { project, runs, titles, layout }) => {
  const { window, evaluate, until } = context;
  const [a, b] = project.panels.map(panel => panel.id);
  const { settle, save, rect, panel, size, mouse } = require('../support/panel-driver.cjs')(context, project.id);
  const run = runs.find(run => run.panelId === a);
  const canvas = await rect('.canvas');
  // A real OSC title can cross the compact-header threshold while a drag is held.
  await save({ ...layout, ratio: 218 / canvas.width });
  assert.equal(await evaluate(`document.querySelector('${panel(a)}').dataset.tiny`), 'false');
  const terminalBeforeTitle = await rect(`${panel(a)} .terminal-container`);
  const sizeBeforeTitle = await size(run);
  const titleSource = await rect(`${panel(a)} .panel-header`), titleTarget = await rect(panel(b));
  mouse('mouseDown', titleSource.x + 30, titleSource.y + 12);
  mouse('mouseMove', titleTarget.x + 30, titleTarget.y + 12);
  await until(() => evaluate(`!!document.querySelector('.panel-swap-preview')`));
  const titleOutputStart = await evaluate('window.observedOutput.length');
  const wideTitle = 'WWWWWWWWWWWW title changed during drag';
  await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify('title:' + wideTitle + ' | directory')})`);
  await until(() => evaluate(`document.querySelector('${panel(a)} .session-title').textContent === ${JSON.stringify(wideTitle)}`));
  await settle();
  assert.deepEqual(await rect(`${panel(a)} .terminal-container`), terminalBeforeTitle, 'Live OSC title changes must not alter real terminal geometry during a held preview');
  assert.equal(await evaluate(`window.observedOutput.slice(${titleOutputStart}).some(event => event.runId === ${JSON.stringify(run.id)} && /SIZE:/.test(event.data))`), false, 'Live title changes emit no PTY resize during preview');
  assert.deepEqual(await size(run), sizeBeforeTitle);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  mouse('mouseUp', titleTarget.x + 30, titleTarget.y + 12);
  await until(() => evaluate(`!document.querySelector('.panel-swap-preview') && document.querySelector('${panel(a)}').dataset.tiny === 'true'`));
  await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify('title:' + titles[0] + ' | directory')})`);
  await until(() => evaluate(`document.querySelector('${panel(a)} .session-title').textContent === ${JSON.stringify(titles[0])}`));
  console.log('Live OSC title updates preserve real terminal geometry and PTY size throughout a held preview; compact layout updates after cancellation.');
  await settle();
  const beforeTitleCommit = await rect(`${panel(a)} .terminal-container`);
  mouse('mouseDown', titleSource.x + 30, titleSource.y + 12);
  mouse('mouseMove', titleTarget.x + 30, titleTarget.y + 12);
  await until(() => evaluate(`!!document.querySelector('.panel-swap-preview')`));
  for (const changed of [wideTitle, 'WWWWWWWWWWWW newest title before commit']) {
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify('title:' + changed + ' | directory')})`);
    await until(() => evaluate(`document.querySelector('${panel(a)} .session-title').textContent === ${JSON.stringify(changed)}`));
    await settle();
    assert.deepEqual(await rect(`${panel(a)} .terminal-container`), beforeTitleCommit);
  }
  mouse('mouseUp', titleTarget.x + 30, titleTarget.y + 12);
  await until(async () => (await evaluate('window.workbench.snapshot()')).projects[0].layout.first.panel === b);
  await settle();
  assert.equal(await evaluate(`document.querySelector('${panel(a)}').dataset.tiny`), 'false', 'Commit measures the latest title in the final, wider layout');
  assert.notDeepEqual(await rect(`${panel(a)} .terminal-container`), beforeTitleCommit);
  assert.equal(await evaluate(`document.querySelector('[data-panel-id="${a}"] .xterm') === window.originalTerminal`), true);
  await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify('title:' + titles[0] + ' | directory')})`);
  await until(() => evaluate(`document.querySelector('${panel(a)} .session-title').textContent === ${JSON.stringify(titles[0])}`));
  console.log('Repeated title snapshots preserve a held preview; commit measures the final layout without replacing the terminal.');
};
