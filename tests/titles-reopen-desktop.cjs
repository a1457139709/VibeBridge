const assert = require('node:assert/strict');

module.exports = async ({ window, evaluate, until, snapshot, target }) => {
  const source = snapshot.projects.find(project => project.id === snapshot.activeProjectId);
  assert.equal(snapshot.runs.some(run => run.projectId === target.id), false, 'target is dormant after real reopen');
  const title = '  New startup OSC | exact title  ';
  await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { ...snapshot.settings.agents, codex: { ...snapshot.settings.agents.codex, args: [...snapshot.settings.agents.codex.args, '--initial-title', title] } } })})`);
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, snapshot.runs, 'new startup command does not alter active runs');
  await evaluate(`window.titleOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output') window.titleOutput.push(event); }); void 0;`);
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate(`document.querySelector('[data-panel-id="${source.panels[0].id}"] button[aria-label="放大面板"]').click()`);
    await until(() => evaluate(`!!document.querySelector('button[aria-label="还原面板"]')`));
    const panel = target.panels[0].id;
    await evaluate(`document.querySelector('[data-locate-panel-id="${panel}"]').click()`);
    await until(() => evaluate(`document.querySelector('[data-panel-id="${panel}"] .session-title')?.textContent === ${JSON.stringify(title)}`));
    await until(() => evaluate(`!!document.querySelector('.notice.success')`));
    assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${panel}"] .session-title').textContent`), title);
    assert.equal(await evaluate(`document.querySelector('.notice.success > span:nth-child(2)').textContent`), '已切换至：' + title, 'notice uses current target run title, not the pre-activation snapshot');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === '${panel}'`));
    window.focus(); window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate(`window.titleOutput.some(event => event.data.includes('INPUT:k'))`));
    const run = (await evaluate('window.workbench.snapshot()')).runs.find(run => run.panelId === panel);
    assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes('INPUT:k')).map(event => event.runId))]`), [run.id]);
  } finally { await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); window.webContents.debugger.detach(); }
  console.log('PASS: dormant project startup OSC after real reopen is identical in header/navigation/reduced-motion notice; native input reaches only its new run');
};
