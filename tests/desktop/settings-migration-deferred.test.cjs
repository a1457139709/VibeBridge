const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

module.exports = {
  configure: settings => ({ ...settings, shortcuts: { nextPanel: 'Command+Shift+W' } }),
  async run({ evaluate, click, until, directory }) {
    await until(() => evaluate(`!!document.querySelector('[aria-label="快捷键迁移提醒"]')`));
    const original = await readFile(`${directory}/settings.json`, 'utf8');
    await click('关闭快捷键迁移提醒');
    await click('全局设置'); await click('快捷键');
    assert.equal(await evaluate(`document.querySelectorAll('.shortcut-row input[aria-invalid="true"]').length`), 2);
    await click('‹ 返回'); await click('全局设置');
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="快捷键迁移提醒"]')`), false, 'dismissal lasts for this startup');
    return { afterQuit: async () => assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original) };
  },
  async reopen({ evaluate, click, until }) {
    await until(() => evaluate(`!!document.querySelector('[aria-label="快捷键迁移提醒"]')`));
    await click('全局设置');
    await click('打开快捷键设置');
    assert.equal(await evaluate(`document.querySelector('[aria-label="设置分类"] [aria-current="page"]').textContent`), '快捷键');
    await click('关闭快捷键迁移提醒');
    assert.equal(await evaluate(`!!document.querySelector('[aria-label="快捷键迁移提醒"]')`), false);
  },
};
