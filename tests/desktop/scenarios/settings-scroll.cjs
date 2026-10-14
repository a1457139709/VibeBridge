const assert = require('node:assert/strict');
module.exports = async function verifySettingsScroll({ window, evaluate, click, until }) {
  window.setSize(900, 580);
  await click('全局设置');
  const boxes = () => evaluate(`(() => {
    const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, bottom: b.bottom }; };
    return { title: box(document.querySelector('.settings-page h1')), navigation: box(document.querySelector('[aria-label="设置分类"]')), back: box([...document.querySelectorAll('button')].find(b => b.textContent === '‹ 返回')), save: box([...document.querySelectorAll('button')].find(b => b.textContent === '保存')), command: box(document.getElementById('command-codex')) };
  })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const before = await boxes();
  assert.ok(before.save.y < before.title.bottom + 150, 'save is fixed at upper-right of category content');
  window.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(before.command.x + 40), y: Math.round(before.command.y + 10), deltaY: -600, canScroll: true });
  await until(async () => (await boxes()).command.y < before.command.y - 50);
  const after = await boxes();
  assert.deepEqual(after.title, before.title); assert.deepEqual(after.navigation, before.navigation); assert.deepEqual(after.back, before.back); assert.deepEqual(after.save, before.save);
  await click('外观'); await click('Agent');
  await until(async () => Math.abs((await boxes()).command.y - before.command.y) < 1);
  await click('‹ 返回'); window.setSize(1200, 800);
};
