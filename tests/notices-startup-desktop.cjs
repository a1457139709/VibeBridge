const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

module.exports = async function verifyStartupNotices({ evaluate, click, until, directory }) {
  await until(() => evaluate(`document.querySelector('.notice.error')?.textContent.includes('配置读取失败')`));
  const started = Date.now();
  await until(() => evaluate(`!document.querySelector('.notice.error')`));
  assert.ok(Date.now() - started >= 4500, 'startup errors remain for five seconds');
  await click('全局设置');
  await click('保存 Agent 设置');
  await until(() => evaluate(`document.querySelector('.notice.error')?.textContent.includes('未覆盖原配置')`));
  assert.equal(await evaluate(`!!document.querySelector('.settings-page')`), true);
  assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), '{damaged configuration');
  console.log('Damaged startup settings notice, five-second expiration, failed-save retry and original-file preservation passed.');
};
