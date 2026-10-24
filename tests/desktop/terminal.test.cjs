const assert = require('node:assert/strict');

module.exports = {
  async run(context) {
    const { window, evaluate, until, click } = context;
    await evaluate('window.output = ""; window.workbench.subscribe(event => { if (event.kind === "output") window.output += event.data; }); void 0;');
    const before = await require('./support/project.cjs')(context);
    const [run] = before.runs;
    assert.equal(run.state, 'running'); assert.ok(run.pid);
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'));
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("INPUT:k")'));
    // Keep the descendant check bounded to the one retained cleanup flow.
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'child')`);
    await until(() => evaluate('/CHILD:\\d+/.test(window.output)'));
    const child = Number(await evaluate('window.output.match(/CHILD:(\\d+)/)[1]'));
    process.kill(child, 0);
    await click('Close panel');
    await until(async () => !(await evaluate('window.workbench.snapshot()')).runs.length);
    await until(() => evaluate('document.body.innerText.includes("This project has no Agent Panels yet")'));
    assert.throws(() => process.kill(run.pid, 0));
    assert.throws(() => process.kill(child, 0));
    console.log('Native terminal input rendered its CLI echo; closing the panel removed the run and descendant.');
  },
};
