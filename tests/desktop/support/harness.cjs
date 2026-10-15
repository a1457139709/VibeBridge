const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { app, BrowserWindow, clipboard, ClipboardItem, dialog } = require('electron');

async function until(check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for desktop');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

void (async () => {
  const directory = process.env.VIBEBRIDGE_TEST_DATA;
  process.env.VIBEBRIDGE_DATA_DIR = directory;
  const suite = require(process.env.VIBEBRIDGE_TEST_SUITE);
  const reopen = !!process.env.VIBEBRIDGE_TEST_REOPEN;
  const command = { command: 'node', args: [resolve('tests/fixtures/interactive.cjs')] };
  if (!reopen) {
    let settings = { theme: process.env.VIBEBRIDGE_TEST_THEME || 'light', agents: { codex: command, claude: command, pi: command } };
    if (suite.configure) settings = await suite.configure(settings);
    await writeFile(`${directory}/settings.json`, typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  let answer = 0;
  let confirmations = 0;
  dialog.showMessageBox = async (_window, options) => {
    if (options.type === 'error') {
      if (suite.expectedDialogError) { assert.match(options.detail, suite.expectedDialogError); return { response: 0 }; }
      throw new Error(options.detail);
    }
    confirmations++;
    return { response: answer };
  };
  require(process.env.VIBEBRIDGE_TEST_ENTRY);
  await app.whenReady();
  await until(() => BrowserWindow.getAllWindows().length);
  const window = BrowserWindow.getAllWindows()[0];
  window.webContents.setBackgroundThrottling(false);
  app.focus({ steal: true }); window.focus(); window.webContents.focus();
  const evaluate = async code => {
    try { return await window.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Desktop script failed: ${code}`, { cause: error }); }
  };
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message); });
  const click = label => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button'); button.click(); })()`);
  const fill = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const verifyArrows = async panelId => {
    const run = (await evaluate('window.workbench.snapshot()')).runs.find(run => run.panelId === panelId);
    assert.equal(await evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId`), panelId);
    for (const [mode, prefix] of [['normal', '1b5b'], ['application', '1b4f']]) {
      const modeStart = await evaluate('window.observedOutput.length');
      await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'cursor-${mode}')`);
      await until(() => evaluate(`window.observedOutput.slice(${modeStart}).some(event => event.runId === ${JSON.stringify(run.id)} && event.data.includes('INPUT:cursor-${mode}'))`));
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      for (const [keyCode, suffix] of [['Left', '44'], ['Right', '43']]) {
        const expected = prefix + suffix;
        const start = await evaluate('window.observedOutput.length');
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        await until(() => evaluate(`window.observedOutput.slice(${start}).some(event => event.data.includes('BYTES:${expected}'))`));
        assert.deepEqual(await evaluate(`[...new Set(window.observedOutput.slice(${start}).filter(event => event.data.includes('BYTES:${expected}')).map(event => event.runId))]`), [run.id]);
      }
    }
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'cursor-normal')`);
  };
  // Select and copy visible terminal text through the native UI, without inspecting xterm internals.
  const copyTerminal = async panelId => {
    const previous = await Promise.all((await clipboard.read()).filter(item => item.types.length).map(async item =>
      new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
    try {
      clipboard.clear();
      const box = await evaluate(`(() => { const b = document.querySelector('[data-panel-id="${panelId}"] .xterm-screen').getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', x: Math.ceil(box.left), y: Math.ceil(box.top + 2), button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.floor(box.right - 2), y: Math.floor(box.bottom - 2), modifiers: ['leftButtonDown'] });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: Math.floor(box.right - 2), y: Math.floor(box.bottom - 2), button: 'left', clickCount: 1 });
      window.webContents.copy();
      await until(async () => !!(await clipboard.readText()));
      return await clipboard.readText();
    } finally {
      await clipboard.write(previous);
    }
  };
  try {
    const context = { app, window, evaluate, click, fill, until, directory, dialog, reopen,
      copyTerminal, verifyArrows, confirmationCount: () => confirmations };
    const result = await (reopen ? suite.reopen : suite.run)(context);
    const runs = (await evaluate('window.workbench.snapshot()')).runs;
    answer = 1;
    app.once('will-quit', event => {
      event.preventDefault();
      void (async () => {
        for (const run of runs) if (run.pid) assert.throws(() => process.kill(run.pid, 0));
        await result?.afterQuit?.();
        app.exit(0);
      })().catch(error => { console.error(error); app.exit(1); });
    });
    app.quit();
  } catch (error) {
    console.error(error);
    await require('./evidence.cjs')(window)('test-failure').catch(() => {});
    answer = 1;
    app.once('will-quit', () => { app.exit(1); });
    app.quit();
  }
})().catch(error => { console.error(error); app.exit(1); });
