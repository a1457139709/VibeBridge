const assert = require('node:assert/strict');

module.exports = async (context, { first, second, firstRun }, { restored }) => {
  const { window, evaluate, until, click } = context;
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
};
