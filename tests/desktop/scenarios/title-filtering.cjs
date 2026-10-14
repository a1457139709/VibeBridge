const assert = require('node:assert/strict');

module.exports = async ({ window, evaluate, until, project, runs }) => {
  const evidence = require('../support/evidence.cjs');
  const screenshot = evidence(window);
  const panelFor = agent => project.panels.find(panel => panel.agent === agent);
  let sequence = 0;
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const emit = async (agent, raw) => {
    const run = runs.find(run => run.panelId === panelFor(agent).id);
    const id = `filtered-title-${sequence++}`;
    const osc = '\x1b]2;' + raw + '\x07';
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ id, chunks: [osc] }) + '\n')})`);
    await until(() => evaluate(`window.titleOutput.some(event => event.runId === ${JSON.stringify(run.id)} && event.data.includes(${JSON.stringify('DONE:' + id)}))`));
    await settle();
    assert.equal((await evaluate('window.workbench.snapshot()')).runs.find(item => item.id === run.id).rawTitle, raw);
    assert.ok(await evaluate(`window.titleOutput.filter(event => event.runId === ${JSON.stringify(run.id)}).map(event => event.data).join('').includes(${JSON.stringify(osc)})`), 'PTY output retains the exact original OSC');
  };
  const titles = agent => {
    const panel = panelFor(agent);
    return evaluate(`[document.querySelector('[data-panel-id="${panel.id}"] .session-title').textContent, document.querySelector('[data-locate-panel-id="${panel.id}"] .session-title').textContent]`);
  };
  const locate = async panel => {
    await evaluate(`document.querySelector('[data-locate-panel-id="${panel.id}"]').click()`);
    await until(() => evaluate(`!document.querySelector('.locating-panel') && document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(panel.id)}`));
  };
  const check = async (agent, raw, expected) => {
    await emit(agent, raw);
    assert.deepEqual(await titles(agent), [expected, expected], `${agent}: ${raw}`);
    const panel = panelFor(agent);
    await locate(project.panels.find(item => item.id !== panel.id));
    await evaluate(`[...document.querySelectorAll('.notice button[aria-label="关闭提示"]')].forEach(button => button.click())`);
    await settle();
    await locate(panel);
    assert.equal(await evaluate(`[...document.querySelectorAll('.notice.success > span:nth-child(2)')].at(-1)?.textContent`), '已切换至：' + expected);
  };
  await until(() => evaluate(`new Set(window.titleOutput.filter(event => event.data.includes('READY:')).map(event => event.runId)).size === 3`));
  for (const agent of ['claude', 'codex', 'pi']) assert.deepEqual(await titles(agent), ['Untitled task', 'Untitled task']);
  await evaluate(`document.querySelector('[data-panel-id="${project.panels[0].id}"] button[aria-label="放大面板"]').click()`);
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await check('claude', '✳ Claude Code', 'Untitled task');
    await check('claude', '✳ 111', '111');
    await check('claude', '◐ Review  A ✳ B 👩🏽‍💻 ◑', 'Review  A ✳ B 👩🏽‍💻');
    await check('codex', 'Respond to greeting | VibeBridge', 'Respond to greeting');
    await check('codex', '111 | VibeBridge', '111');
    await check('codex', 'VibeBridge', 'Untitled task');
    await check('codex', 'another-directory', 'Untitled task');
    await check('codex', '⠋ Keep  A ⠙ B ✳ 👩🏽‍💻 | directory ⠹', 'Keep  A ⠙ B ✳ 👩🏽‍💻');
    await check('pi', 'π - A', 'Untitled task');
    await check('pi', 'π - 111 - A', '111');
    await check('pi', 'π - Read  A + B 👩🏽‍💻 - other-directory', 'Read  A + B 👩🏽‍💻');
    for (const [agent, raw, expected] of [
      ['claude', '★ Custom  ✳ title ⟡', '★ Custom  ✳ title ⟡'],
      ['claude', '  ◑  ', 'Untitled task'],
      ['codex', '⠙ Custom | name | directory ⠹', 'Custom | name | directory'],
      ['codex', ' | directory', '| directory'],
      ['codex', 'name | ', 'name |'],
      ['codex', 'name | | directory', 'name | | directory'],
      ['codex', '★ Name|part  + 😀 | directory', '★ Name|part  + 😀'],
      ['pi', 'Custom  π title ✳', 'Custom  π title ✳'],
      ['pi', 'π - A - B - C', 'π - A - B - C'],
      ['pi', 'π -  - A', 'π -  - A'],
      ['pi', 'π - name - ', 'π - name -'],
      ['pi', 'π - name - - A', 'π - name - - A'],
    ]) await check(agent, raw, expected);
    for (const agent of ['claude', 'codex', 'pi']) {
      await check(agent, '', 'Untitled task');
      await check(agent, '   ', 'Untitled task');
    }
    await check('claude', '✳ 111', '111');
    await screenshot('claude-panel-navigation-notice');
    await check('codex', '⠋ Respond to greeting | VibeBridge', 'Respond to greeting');
    await screenshot('codex-panel-navigation-notice');
    await check('pi', 'π - 111 - A', '111');
    await screenshot('pi-panel-navigation-notice');
  } finally {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    window.webContents.debugger.detach();
    await evaluate(`document.querySelector('button[aria-label="还原面板"]').click()`);
    await settle();
  }
  await evaluate(`[...document.querySelectorAll('.notice button[aria-label="关闭提示"]')].forEach(button => button.click())`);
  await screenshot('three-filtered-titles');
  await evaluate(`(() => { window.titleFrames = []; window.sampleTitles = true;
    const sample = () => { if (!window.sampleTitles) return;
      window.titleFrames.push([...document.querySelectorAll('.session-title')].map(element => element.textContent));
      requestAnimationFrame(sample);
    }; requestAnimationFrame(sample); })()`);
  const stopRecording = await evidence.record(window, 'status-stability');
  try {
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const mark of ['✳', '◐', '◑']) {
        await emit('claude', `${mark} 111 ${mark}`);
        await emit('codex', `${['⠋', '⠙', '⠹'][cycle % 3]} Respond to greeting | VibeBridge ${['⠹', '⠋', '⠙'][cycle % 3]}`);
        await evaluate('new Promise(resolve => setTimeout(resolve, 100))');
      }
    }
    // A quiet CLI keeps its last title. A new run's no-signal fallback is checked
    // both above and in the real application quit/reopen pass.
    await evaluate('new Promise(resolve => setTimeout(resolve, 2200))');
    for (const [agent, character] of [['claude', 'j'], ['codex', 'h'], ['pi', 'i']]) {
      const panel = panelFor(agent);
      await locate(panel);
      window.focus(); window.webContents.focus();
      const start = await evaluate('window.titleOutput.length');
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await until(() => evaluate(`window.titleOutput.slice(${start}).some(event => event.data.includes(${JSON.stringify('INPUT:' + character)}))`));
      assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.slice(${start}).filter(event => event.data.includes(${JSON.stringify('INPUT:' + character)})).map(event => event.runId))]`), [runs.find(run => run.panelId === panel.id).id]);
    }
  } finally {
    await evaluate('window.sampleTitles = false');
    await stopRecording();
  }
  const frames = await evaluate('window.titleFrames');
  assert.ok(frames.length >= 100, 'Observe displayed names across continuous status changes and silence');
  for (const frame of frames) assert.deepEqual(frame, ['Respond to greeting', '111', '111', 'Respond to greeting', '111', '111']);
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.map(run => [run.id, run.pid]), runs.map(run => [run.id, run.pid]));
  console.log(`PASS: confirmed CLI samples, unknown/ambiguous/empty forms, exact raw OSC, three matching displays and native input; ${frames.length} frames retain stable names through status changes and silence`);
};
