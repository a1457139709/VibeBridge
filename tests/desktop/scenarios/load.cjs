const assert = require('node:assert/strict');
const { app } = require('electron');

module.exports = async function verifyLoad({ window, evaluate, click, until }) {
  const before = await evaluate('window.workbench.snapshot()');
  const active = before.projects.find(project => project.id === before.activeProjectId);
  const other = before.projects.find(project => project.id !== active.id && project.panels.length);
  const added = [];
  const addedPids = [];
  const memoryMiB = () => Math.round(app.getAppMetrics().reduce((sum, process) => sum + process.memory.workingSetSize, 0) / 1024);
  await evaluate(`window.loadActive = true; window.loadOutput = {}; window.loadBytes = 0; window.loadInputRuns = new Set();
    window.stopLoadObserver = window.workbench.subscribe(event => {
      if (event.kind === 'output') {
        window.loadBytes += event.data.length;
        window.loadOutput[event.runId] = ((window.loadOutput[event.runId] || '') + event.data).slice(-2048);
        if (window.loadOutput[event.runId].includes('INPUT:q')) window.loadInputRuns.add(event.runId);
      }
    }); void 0;`);
  try {
    for (const count of [4, 10]) {
      while ((await evaluate('window.workbench.snapshot()')).runs.length < count) {
        const addition = await evaluate(`window.workbench.addPanel(${JSON.stringify(other.id)}, 'codex')`);
        added.push(addition.panel.id);
        addedPids.push(addition.launch.run.pid);
        await until(() => evaluate(`(window.loadOutput[${JSON.stringify(addition.launch.run.id)}] || '').includes('READY:')`));
      }
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      const memoryBefore = memoryMiB();
      const start = Date.now();
      await evaluate(`Promise.all(${JSON.stringify(runs)}.map(run => window.workbench.sendInput(run.id, 'stream')))`);
      const switchStart = Date.now();
      await click(other.name);
      await until(() => evaluate(`document.querySelector('.workspace-toolbar strong')?.textContent === ${JSON.stringify(other.name)}`));
      await click(active.name);
      const target = active.panels[0].id;
      await until(() => evaluate(`!!document.querySelector('[data-panel-id="${target}"] .xterm-helper-textarea')`));
      const switchMs = Date.now() - switchStart;
      await evaluate(`document.querySelector('[data-panel-id="${target}"] .panel-header').click()`);
      await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(target)}`));
      const inputStart = Date.now();
      window.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
      await until(() => evaluate(`window.loadInputRuns.size > 0`));
      const inputMs = Date.now() - inputStart;
      assert.deepEqual(await evaluate(`[...window.loadInputRuns]`), [runs.find(run => run.panelId === target).id]);
      const divider = await evaluate(`(() => { const b = document.querySelector('.divider').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
      window.webContents.sendInputEvent({ type: 'mouseDown', ...divider, button: 'left', clickCount: 1 });
      await until(() => evaluate(`document.querySelector('.canvas').classList.contains('resizing')`));
      window.webContents.sendInputEvent({ type: 'mouseMove', x: divider.x + 20, y: divider.y + 20, modifiers: ['leftButtonDown'] });
      window.webContents.sendInputEvent({ type: 'mouseUp', x: divider.x + 20, y: divider.y + 20, button: 'left', clickCount: 1 });
      await until(() => evaluate(`!document.querySelector('.canvas').classList.contains('resizing')`));
      // A cursor-report reply proves that xterm parsed the final control sequence, including hidden runs.
      await until(() => evaluate(`${JSON.stringify(runs)}.every(run => (window.loadOutput[run.id] || '').includes('FINAL:') && /INPUT:\\x1b\\[2;1R/.test(window.loadOutput[run.id] || ''))`));
      assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, runs);
      console.log(`Load ${count} runs: input ${inputMs} ms, two switches ${switchMs} ms, all terminal parsers drained ${Date.now() - start} ms, received ${await evaluate('window.loadBytes')} characters, Electron working set ${memoryBefore} -> ${memoryMiB()} MiB`);
      await evaluate('window.loadOutput = {}; window.loadBytes = 0; window.loadInputRuns.clear();');
    }
  } finally {
    await evaluate('window.stopLoadObserver(); window.loadActive = false;');
    for (const panel of added) await evaluate(`window.workbench.closePanel(${JSON.stringify(other.id)}, ${JSON.stringify(panel)})`);
    for (const pid of addedPids) assert.throws(() => process.kill(pid, 0));
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(active.id)}, ${JSON.stringify(active.layout)})`);
    await click(active.name);
  }
};
