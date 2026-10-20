const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { app, BrowserWindow, dialog } = require('electron');

async function until(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for desktop');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

let window;
async function fail(error) {
  console.error(error);
  window ??= BrowserWindow.getAllWindows()[0];
  if (window && !window.isDestroyed()) {
    await require('./evidence.cjs')(window).catch(error => console.error('Capture failed:', error));
  }
  // Let the product perform its normal run cleanup even after an assertion fails.
  app.once('will-quit', () => app.exit(1));
  app.quit();
}

void (async () => {
  const directory = process.env.VIBEBRIDGE_TEST_DATA;
  process.env.VIBEBRIDGE_DATA_DIR = directory;
  const suite = require(process.env.VIBEBRIDGE_TEST_SUITE);
  const reopen = !!process.env.VIBEBRIDGE_TEST_REOPEN;
  if (!reopen) {
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/interactive.cjs')] };
    await writeFile(`${directory}/settings.json`, JSON.stringify({ theme: 'light', agents: { codex: command, claude: command, pi: command } }));
  }
  dialog.showMessageBox = async (_window, options) => {
    if (options.type === 'error') throw new Error(options.detail);
    return { response: 1 };
  };
  require(process.env.VIBEBRIDGE_TEST_ENTRY);
  await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length);
  window = BrowserWindow.getAllWindows()[0];
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on('console-message', details => console.log(`[renderer:${details.level}] ${details.message}`));
  window.webContents.on('render-process-gone', (_event, details) => console.error('Renderer exited:', details));
  app.focus({ steal: true }); window.focus(); window.webContents.focus();
  const evaluate = async code => {
    try { return await window.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Desktop script failed: ${code}`, { cause: error }); }
  };
  await until(() => evaluate('!!window.workbench && !!document.querySelector("h1, .workspace")'));
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button'); button.click(); })()`);
  const fill = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const result = await (reopen ? suite.reopen : suite.run)({ app, window, evaluate, click, fill, until, directory });
  const runs = (await evaluate('window.workbench.snapshot()')).runs;
  app.once('will-quit', event => {
    event.preventDefault();
    void (async () => {
      for (const run of runs) if (run.pid) assert.throws(() => process.kill(run.pid, 0));
      await result?.afterQuit?.();
      app.exit(0);
    })().catch(error => { console.error(error); app.exit(1); });
  });
  app.quit();
})().catch(fail);
