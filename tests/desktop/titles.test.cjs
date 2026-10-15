const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

async function verifyTitles({ window, evaluate, click, fill, until, directory, reopen }) {
  if (reopen) {
    const saved = JSON.parse(await readFile(join(directory, 'titles-expected.json'), 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(() => evaluate(`document.querySelectorAll('.canvas .xterm').length === ${active.panels.length}`));
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(snapshot.projects, saved.projects);
    assert.ok(snapshot.runs.every(run => !saved.runs.some(old => old.id === run.id) && run.rawTitle === undefined));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), active.panels.map(panel => panel.id));
    assert.equal(await evaluate(`document.querySelectorAll('.session-title').length === [...document.querySelectorAll('.session-title')].filter(title => title.textContent === 'Untitled task').length`), true);
    assert.equal(await evaluate(`!!document.querySelector('button[aria-label="还原面板"]')`), false);
    for (const project of saved.projects.filter(project => project.id !== active.id)) {
      await click(`展开项目面板：${project.name}`);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-project-id="${project.id}"] [data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), project.panels.map(panel => panel.id));
    }
    await require('./scenarios/titles-reopen.cjs')({ window, evaluate, until, snapshot, target: saved.projects.find(project => project.name === 'Dormant startup target') });
    console.log('PASS: real quit/reopen preserves creation order and committed layouts, resets expansion/maximize/raw titles, and starts new runs');
    return;
  }
  await until(() => evaluate(`!!document.querySelector('.setup')`));
  await evaluate(`window.titleOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output') window.titleOutput.push(event); }); void 0;`);
  const create = (name, path, total, counts = { codex: total, claude: 0, pi: 0 }) => evaluate(`window.workbench.createProject(${JSON.stringify({ name, directory: path, total, counts })})`);
  const first = (await create('First title project', directory, 3, { codex: 1, claude: 1, pi: 1 })).project;
  await click(first.name);
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
  const before = await evaluate('window.workbench.snapshot()');
  const firstRun = before.runs.find(run => run.panelId === first.panels[0].id);
  await until(() => evaluate(`window.titleOutput.some(event => event.runId === ${JSON.stringify(firstRun.id)} && event.data.includes('READY:'))`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), first.panels.map(panel => panel.id));
  assert.equal(await evaluate(`document.querySelector('[data-panel-id="${first.panels[0].id}"] .session-title').textContent`), 'Untitled task');
  await require('./scenarios/title-filtering.cjs')({ window, evaluate, until, project: first, runs: before.runs });
  const raw = 'Exact session title | directory';
  const displayed = 'Exact session title';
  await evaluate(`window.workbench.sendInput(${JSON.stringify(firstRun.id)}, ${JSON.stringify(JSON.stringify({ id: 'desktop-title', chunks: ['\x1b]2;' + raw + '\x07'] }) + '\n')})`);
  await until(() => evaluate(`document.querySelector('[data-panel-id="${first.panels[0].id}"] .session-title').textContent === ${JSON.stringify(displayed)}`));
  assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"] .session-title').textContent`), displayed);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="更多面板操作"]').length`), 0);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.session-title')).whiteSpace`), 'pre');
  assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').title`), displayed);
  // Clicking the already selected item must take focus back from navigation and deliver input once.
  window.focus(); window.webContents.focus();
  await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').focus(); document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').click()`);
  await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(first.panels[0].id)}`));
  window.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
  await until(() => evaluate(`window.titleOutput.some(event => event.data.includes('INPUT:q'))`));
  assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes('INPUT:q')).map(event => event.runId))]`), [firstRun.id]);
  console.log('PASS: shared filtered title, creation-ordered navigation, removed More menu and same-selected native refocus');
  if (process.env.VIBEBRIDGE_TEST_SCREENSHOT) await writeFile(process.env.VIBEBRIDGE_TEST_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  const secondDirectory = join(directory, 'second'); await mkdir(secondDirectory);
  const second = (await create('Second title project', secondDirectory, 2)).project;
  await click(second.name);
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 2`));
  const projectSnapshots = (await evaluate('window.workbench.snapshot()')).projects;
  const runs = (await evaluate('window.workbench.snapshot()')).runs;
  const locate = async (panelId, character) => {
    await evaluate(`document.querySelector('[data-locate-panel-id="${panelId}"]').focus(); document.querySelector('[data-locate-panel-id="${panelId}"]').click()`);
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(panelId)}`));
    if (character) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await until(() => evaluate(`window.titleOutput.some(event => event.data.includes(${JSON.stringify('INPUT:' + character)}))`));
      assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes(${JSON.stringify('INPUT:' + character)})).map(event => event.runId))]`), [runs.find(run => run.panelId === panelId).id]);
    }
    await until(() => evaluate(`!document.querySelector('.locating-panel')`));
  };
  const restored = panelId => evaluate(`!!document.querySelector('[data-panel-id="${panelId}"] button[aria-label="还原面板"]')`);
  const maximize = panelId => evaluate(`document.querySelector('[data-panel-id="${panelId}"] button[aria-label="放大面板"]').click()`);
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
  // Project heading switches retain per-project viewing state; disclosure has no run side effects.
  await click(second.name);
  await until(() => restored(second.panels[0].id));
  await click(first.name);
  await until(() => restored(first.panels[2].id));
  const runIdentities = (await evaluate('window.workbench.snapshot()')).runs.map(run => [run.id, run.pid]);
  await click(`收起项目面板：${first.name}`);
  assert.equal(await evaluate(`document.querySelectorAll('[data-project-id="${first.id}"] [data-locate-panel-id]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('[data-project-id="${second.id}"] [data-locate-panel-id]').length`), 2);
  await click(second.name); await click(first.name);
  assert.equal(await evaluate(`document.querySelectorAll('[data-project-id="${first.id}"] [data-locate-panel-id]').length`), 0, 'Explicit collapse survives project heading switches');
  await click(`展开项目面板：${first.name}`);
  assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.map(run => [run.id, run.pid]), runIdentities);
  await click('还原面板');
  await until(() => evaluate(`!document.querySelector('button[aria-label="还原面板"]')`));
  const settle = () => evaluate('new Promise(resolve => setTimeout(() => requestAnimationFrame(resolve), 250))');
  const order = () => evaluate(`[...document.querySelectorAll('[data-project-id="${first.id}"] [data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`);
  const expectedOrder = first.panels.map(panel => panel.id);
  const [a, b, c] = expectedOrder;
  const arranged = { axis: 'row', ratio: .55, first: { panel: a }, second: { axis: 'column', ratio: .5, first: { panel: b }, second: { panel: c } } };
  await evaluate(`window.workbench.saveLayout(${JSON.stringify(first.id)}, ${JSON.stringify(arranged)})`); await settle();
  await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))`);
  const rect = selector => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const boxes = await Promise.all(expectedOrder.map(id => rect(`[data-panel-id="${id}"]`)));
  const long = 'Long title with  spaces 👩🏽‍💻 '.repeat(80).trim();
  const longRaw = long + ' | /some/directory';
  await evaluate(`window.workbench.sendInput(${JSON.stringify(firstRun.id)}, ${JSON.stringify(JSON.stringify({ id: 'long-title', chunks: ['\x1b]2;' + longRaw + '\x07'] }) + '\n')})`);
  try { await until(() => evaluate(`document.querySelector('[data-locate-panel-id="${a}"]').title === ${JSON.stringify(long)}`)); }
  catch (error) { console.error(await evaluate(`({ title: document.querySelector('[data-locate-panel-id="${a}"]').title, tail: window.titleOutput.filter(event => event.runId === ${JSON.stringify(firstRun.id)}).map(event => event.data).join('').slice(-500) })`)); throw error; }
  assert.deepEqual(await Promise.all(expectedOrder.map(id => rect(`[data-panel-id="${id}"]`))), boxes, 'A long session title cannot enlarge its layout slot');
  for (const selector of [`[data-panel-id="${a}"] .session-title`, `[data-locate-panel-id="${a}"] .session-title`]) {
    assert.deepEqual(await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(e); return { ellipsis: s.textOverflow, whitespace: s.whiteSpace, clipped: e.scrollWidth > e.clientWidth, oneLine: e.clientHeight <= parseFloat(s.lineHeight) + 1 }; })()`), { ellipsis: 'ellipsis', whitespace: 'pre', clipped: true, oneLine: true });
  }
  const headerButtons = await evaluate(`[...document.querySelectorAll('[data-panel-id="${a}"] .panel-actions button')].map(button => ({ label: button.getAttribute('aria-label'), visible: button.getBoundingClientRect().width > 0 }))`);
  assert.deepEqual(headerButtons, [{ label: '放大面板', visible: true }, { label: '关闭面板', visible: true }]);
  const mouse = (type, x, y) => window.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : { button: 'left', clickCount: 1 }) });
  const handle = await rect(`[data-panel-id="${a}"] .panel-header`), target = boxes[2];
  mouse('mouseDown', handle.x + 30, handle.y + 12); mouse('mouseMove', handle.x + 45, handle.y + 16);
  await until(() => evaluate(`!!document.querySelector('.panel-drag-image')`));
  mouse('mouseMove', target.x + target.width / 2, target.y + target.height / 2); await settle();
  mouse('mouseUp', target.x + target.width / 2, target.y + target.height / 2); await settle();
  assert.notDeepEqual((await evaluate('window.workbench.snapshot()')).projects.find(project => project.id === first.id).layout, arranged);
  assert.deepEqual(await order(), expectedOrder, 'A native panel swap leaves creation order unchanged');
  const divider = await rect('.divider[aria-orientation="vertical"]');
  const beforeResize = (await evaluate('window.workbench.snapshot()')).projects.find(project => project.id === first.id).layout;
  mouse('mouseDown', divider.x + 2, divider.y + 30); mouse('mouseMove', divider.x - 60, divider.y + 30); mouse('mouseUp', divider.x - 60, divider.y + 30); await settle();
  assert.notDeepEqual((await evaluate('window.workbench.snapshot()')).projects.find(project => project.id === first.id).layout, beforeResize);
  assert.deepEqual(await order(), expectedOrder, 'Native ratio adjustment leaves creation order unchanged');
  await click('添加 Agent');
  await evaluate(`document.querySelector('.agent-option.pi').click()`);
  await until(() => evaluate(`document.querySelectorAll('[data-project-id="${first.id}"] [data-locate-panel-id]').length === 4`));
  const added = (await evaluate('window.workbench.snapshot()')).projects.find(project => project.id === first.id).panels.at(-1);
  assert.deepEqual(await order(), [...expectedOrder, added.id]);
  assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${added.id}"] .agent-mark').textContent`), 'π');
  await evaluate(`document.querySelector('[data-panel-id="${added.id}"] button[aria-label="关闭面板"]').click()`);
  await until(async () => (await order()).length === 3);
  assert.deepEqual(await order(), expectedOrder);
  await require('./scenarios/title-settings.cjs')({ window, evaluate, click, fill, until, directory, first, second, locate });
  for (const panel of second.panels) await evaluate(`window.workbench.closePanel(${JSON.stringify(second.id)}, ${JSON.stringify(panel.id)})`);
  await until(() => evaluate(`document.querySelectorAll('[data-project-id="${second.id}"] [data-locate-panel-id]').length === 0`));
  assert.equal(await evaluate(`document.querySelector('[data-project-id="${second.id}"] .project-link small').textContent`), '0');
  console.log('PASS: independent expansion, per-project maximize memory, long-title ellipsis with permanent actions, native swap/resize order and add/close/zero entries');
  const dormantDirectory = join(directory, 'dormant'); await mkdir(dormantDirectory);
  await create('Dormant startup target', dormantDirectory, 1);
  await click(first.name);
  await until(async () => (await evaluate('window.workbench.snapshot()')).activeProjectId === first.id);
  await writeFile(join(directory, 'titles-expected.json'), JSON.stringify(await evaluate('window.workbench.snapshot()')));
}

module.exports = {
  configure: settings => ({ ...settings, agents: Object.fromEntries(Object.keys(settings.agents)
    .map(agent => [agent, { command: 'node', args: [resolve('tests/fixtures/title-cli.cjs')] }])) }),
  run: verifyTitles,
  reopen: verifyTitles,
};
