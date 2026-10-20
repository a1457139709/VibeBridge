const assert = require('node:assert/strict');

module.exports = async (context, { first, second, runs, projectSnapshots }, { locate, restored, maximize }) => {
  const { window, evaluate, until, click } = context;
  await locate(first.panels[1].id, 's');
  assert.equal(await restored(first.panels[1].id), false, 'split locator remains split');
  await maximize(first.panels[1].id);
  await until(() => restored(first.panels[1].id));
  await locate(second.panels[1].id, 't');
  await until(() => restored(second.panels[1].id));
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects, projectSnapshots);
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, runs);
  await click('还原面板');
  await until(() => evaluate(`!document.querySelector('button[aria-label="还原面板"]')`));
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects, projectSnapshots);
  await locate(first.panels[0].id, 'u');
  assert.equal(await restored(first.panels[0].id), false, 'source split overrides the destination previous maximize mode');
  console.log('PASS: cross-project split/maximize mode follows the source, preserves native input and restores saved layouts');

  const targetRun = runs.find(run => run.panelId === second.panels[0].id);
  const targetTitle = 'keep  spaces';
  const targetRaw = targetTitle + ' | directory';
  await evaluate(`window.workbench.sendInput(${JSON.stringify(targetRun.id)}, ${JSON.stringify(JSON.stringify({ id: 'target-title', chunks: ['\x1b]2;' + targetRaw + '\x07'] }) + '\n')})`);
  await until(() => evaluate(`document.querySelector('[data-locate-panel-id="${second.panels[0].id}"] .session-title').textContent === ${JSON.stringify(targetTitle)}`));
  window.webContents.debugger.attach('1.3');
  try {
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await maximize(first.panels[0].id);
    await until(() => restored(first.panels[0].id));
    await locate(second.panels[0].id, 'v');
    await until(() => evaluate(`document.querySelector('.notice.success')?.textContent.includes(${JSON.stringify('已切换至：' + targetTitle)})`));
    assert.equal(await evaluate(`document.querySelector('[data-panel-id="${second.panels[0].id}"] .session-title').textContent`), targetTitle);
    assert.equal(await evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId`), second.panels[0].id);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.notice.success > span:nth-child(2)')).whiteSpace`), 'pre-wrap');
  } finally { await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] }); window.webContents.debugger.detach(); }
  console.log('PASS: reduced motion switches directly, shares the filtered title in notice and retains native input focus');

  // Observe the real browser animations and geometry without replacing the animation implementation.
  await evaluate(`(() => { const original = window.matchMedia.bind(window); window.matchMedia = query => /prefers-reduced-motion/.test(query)
    ? { matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
    : original(query); })()`);
  await until(() => evaluate(`!matchMedia('(prefers-reduced-motion: reduce)').matches`));
  let motion;
  for (let attempt = 0; attempt < 3; attempt++) {
    await evaluate(`window.motionSamples = []; window.motionAnimations = new Set(); window.motionStart = performance.now(); window.motionSampling = true;
      const sample = () => { if (!window.motionSampling) return; for (const animation of document.getAnimations()) {
        if (animation.effect?.target?.classList.contains('canvas')) { window.motionAnimations.add(animation); window.motionSamples.push({ time: performance.now(), project: document.querySelector('.workspace-toolbar strong')?.textContent, transform: getComputedStyle(animation.effect.target).transform }); }
      } requestAnimationFrame(sample); }; requestAnimationFrame(sample); void 0;`);
    await locate(first.panels[2].id, attempt ? undefined : 'w');
    motion = await evaluate(`(() => { window.motionSampling = false; return { samples: window.motionSamples, animations: [...window.motionAnimations].map(animation => ({ duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes().map(frame => frame.transform) })) }; })()`);
    if (motion.animations.length) break;
    await locate(second.panels[0].id);
  }
  assert.equal(motion.animations.length, 2);
  assert.deepEqual(motion.animations.map(animation => animation.duration), [100, 100]);
  assert.deepEqual(motion.animations.map(animation => animation.frames), [['scale(1)', 'scale(0.96)'], ['scale(0.96)', 'scale(1)']]);
  assert.equal(motion.samples[0].project, second.name);
  assert.equal(motion.samples.at(-1).project, first.name);
  assert.ok(motion.samples.some(sample => sample.transform !== 'none' && sample.transform !== 'matrix(1, 0, 0, 1, 0, 0)'));
  assert.ok(motion.samples.at(-1).time - motion.samples[0].time >= 140, 'The outgoing and incoming halves render sequentially');
  console.log('PASS: native browser renders sequential 100ms shrink/grow halves, preserving focus and live CLI input');
  const beforeRapid = await evaluate('window.workbench.snapshot()');
  const accepted = second.panels[0].id, rejected = second.panels[1].id;
  await evaluate(`document.querySelector('[data-locate-panel-id="${rejected}"]').click(); document.querySelector('[data-locate-panel-id="${accepted}"]').click()`);
  await until(() => evaluate(`!document.querySelector('.locating-panel') && document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(accepted)}`));
  const rapidOutput = await evaluate('window.titleOutput.length');
  window.webContents.sendInputEvent({ type: 'char', keyCode: 'R' });
  await until(() => evaluate(`window.titleOutput.slice(${rapidOutput}).some(event => event.data.includes('INPUT:R'))`));
  assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.slice(${rapidOutput}).filter(event => event.data.includes('INPUT:R')).map(event => event.runId))]`), [runs.find(run => run.panelId === accepted).id]);
  const afterRapid = await evaluate('window.workbench.snapshot()');
  assert.deepEqual(afterRapid.runs, beforeRapid.runs);
  assert.deepEqual(afterRapid.projects, beforeRapid.projects);
  await locate(first.panels[2].id);
  console.log('PASS: rapid native navigation cancels the old animation, delivers input only to the accepted panel and preserves runs/layouts');
};
