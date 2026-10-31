const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

module.exports = {
  async run(context) {
    const { window, evaluate, until, click } = context;
    await evaluate('window.output = ""; window.workbench.subscribe(event => { if (event.kind === "output") window.output += event.data; }); void 0;');
    const before = await require('./support/project.cjs')(context);
    const [run] = runsOf(before);
    assert.equal(run.state, 'running'); assert.ok(run.pid);
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'));
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("INPUT:k")'));

    // Agent CLIs read CSI u Shift+Enter as a newline in their prompt; plain Enter still submits.
    const bytesOf = async (keyCode, modifiers) => {
      await evaluate('window.output = ""; void 0');
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      // A trailing marker shows every byte of the key has arrived; PTY reads may merge them.
      window.webContents.sendInputEvent({ type: 'char', keyCode: '.' });
      await until(() => evaluate('/BYTES:[0-9a-f]*2e[^0-9a-f]/.test(window.output)'));
      return evaluate('[...window.output.matchAll(/BYTES:([0-9a-f]+)/g)].map(match => match[1]).join("")');
    };
    assert.equal(await bytesOf('Enter', ['shift']), '1b5b31333b32752e');
    assert.equal(await bytesOf('Enter', []), '0d2e');
    // Command+C and Command+V stay with the Edit menu, so they copy a selection and paste once.
    const { clipboard } = require('electron');
    clipboard.writeText('pasted-text');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'v', modifiers: ['meta'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'v', modifiers: ['meta'] });
    await until(() => evaluate('window.output.includes("INPUT:pasted-text")'));
    const word = await evaluate(`(() => {
      const row = [...document.querySelectorAll('.xterm-rows > div')].find(row => row.textContent.startsWith('INPUT:k'));
      const { left, top, height } = row.getBoundingClientRect();
      return { x: Math.round(left + 4), y: Math.round(top + height / 2) };
    })()`);
    for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...word, button: 'left', clickCount: 1 });
    for (const type of ['mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, ...word, button: 'left', clickCount: 2 });
    clipboard.writeText('');
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'c', modifiers: ['meta'] });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'c', modifiers: ['meta'] });
    await until(() => clipboard.readText() === 'INPUT:k');
    assert.equal((await evaluate('window.output')).split('INPUT:pasted-text').length, 2);

    // A screen that follows output keeps following after it shrinks while off screen. Off screen
    // the renderer pauses; held idle callbacks keep its earlier size, as on a busy main thread.
    const frames = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve))))';
    for (let i = 0; i < 8; i++) await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'fill-${i}')`);
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("INPUT:fill-7")'));
    await evaluate(`(() => {
      const container = document.querySelector('.terminal-container'); const { width, height } = container.getBoundingClientRect();
      Object.assign(container.style, { position: 'fixed', left: '0', top: '200vh', width: width + 'px', height: height + 'px' });
      window.heldIdle = window.requestIdleCallback; window.requestIdleCallback = () => 0;
    })()`);
    await evaluate(frames);
    await evaluate(`document.querySelector('.terminal-container').style.height = '90px'`);
    await evaluate(frames);
    await evaluate(`document.querySelector('.terminal-container').style.top = '0'; window.requestIdleCallback = window.heldIdle; void 0`);
    await evaluate(frames);
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'after-hidden-resize')`);
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("INPUT:after-hidden-resize")'));
    await evaluate(`document.querySelector('.terminal-container').style.cssText = ''`);
    await evaluate(frames);
    // Keep the descendant check bounded to the one retained cleanup flow.
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'child')`);
    await until(() => evaluate('/CHILD:\\d+/.test(window.output)'));
    const child = Number(await evaluate('window.output.match(/CHILD:(\\d+)/)[1]'));
    process.kill(child, 0);
    await click('Close panel');
    await until(async () => !runsOf(await evaluate('window.workbench.snapshot()')).length);
    await until(() => evaluate('document.body.innerText.includes("This project has no Agent Panels yet")'));
    assert.throws(() => process.kill(run.pid, 0));
    assert.throws(() => process.kill(child, 0));
    console.log('Native terminal input rendered its CLI echo; Shift+Enter sent CSI u while Enter sent a carriage return and Command+C and Command+V copied and pasted; a screen resized off screen kept following output; closing the panel removed the run and descendant.');
  },
};
