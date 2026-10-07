const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

async function until(check) {
  const deadline = Date.now() + 8000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for desktop');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

void (async () => {
  const directory = process.env.VIBEBRIDGE_TEST_DATA;
  process.env.VIBEBRIDGE_DATA_DIR = directory;
  const command = { command: 'node', args: [resolve('tests/fixtures/interactive.cjs')] };
  await writeFile(`${directory}/settings.json`, JSON.stringify({ theme: 'light', agents: { codex: command, claude: command, pi: command } }));
  let answer = 0;
  let confirmations = 0;
  dialog.showMessageBox = async (_window, options) => {
    if (options.type === 'error') throw new Error(options.detail);
    confirmations++;
    return { response: answer };
  };
  require(process.env.VIBEBRIDGE_TEST_ENTRY);
  await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length);
  const window = BrowserWindow.getAllWindows()[0];
  const evaluate = async code => {
    try { return await window.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Desktop script failed: ${code}`, { cause: error }); }
  };
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button'); button.click(); })()`);
  const fill = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  try {
    await until(() => evaluate(`!!document.getElementById('project-name')`));
    assert.match(await evaluate('document.body.innerText'), /已分配 0 \/ 3/);
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
    await fill('project-directory', directory);
    for (const label of ['增加Codex', '增加Claude Code', '增加pi']) await click(label);
    await click('减少窗口数量');
    assert.match(await evaluate('document.body.innerText'), /多分配了 1 个/);
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
    await click('增加窗口数量');
    await click('取消');
    assert.equal((await evaluate('window.workbench.snapshot()')).projects.length, 0);
    await click('创建项目');
    assert.match(await evaluate('document.body.innerText'), /已分配 3 \/ 3/);
    assert.equal(await evaluate(`document.getElementById('project-directory').value`), directory);
    await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
    await evaluate(`window.observedOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output') window.observedOutput.push(event); }); void 0;`);
    await click('创建并启动');
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
    const before = await evaluate('window.workbench.snapshot()');
    assert.equal(before.runs.length, 3);
    await until(() => evaluate(`new Set(window.observedOutput.filter(event => event.data.includes('READY:')).map(event => event.runId)).size === 3`));
    window.focus();
    window.webContents.focus();
    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:k'))`));
    const inputRuns = await evaluate(`[...new Set(window.observedOutput.filter(event => event.data.includes('INPUT:k')).map(event => event.runId))]`);
    assert.equal(inputRuns.length, 1);
    await click('添加项目');
    await click('取消');
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.map(run => run.id), before.runs.map(run => run.id));
    window.close();
    await until(() => confirmations === 1);
    assert.equal(window.isDestroyed(), false);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.map(run => run.id), before.runs.map(run => run.id));
    answer = 1;
    app.once('will-quit', event => {
      event.preventDefault();
      void (async () => {
        for (const run of before.runs) assert.throws(() => process.kill(run.pid, 0));
        console.log('Desktop creation, native terminal input, remount, cancel and confirmed quit passed.');
        app.exit(0);
      })().catch(error => { console.error(error); app.exit(1); });
    });
    app.quit();
  } catch (error) {
    console.error(error);
    answer = 1;
    app.once('will-quit', () => { app.exit(1); });
    app.quit();
  }
})();
