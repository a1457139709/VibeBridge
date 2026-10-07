const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { app, BrowserWindow, clipboard, ClipboardItem, dialog } = require('electron');

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
  if (!process.env.VIBEBRIDGE_TEST_REOPEN) await writeFile(`${directory}/settings.json`, JSON.stringify({ theme: 'light', agents: { codex: command, claude: command, pi: command } }));
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
  // Select and copy visible terminal text through the native UI, without inspecting xterm internals.
  const copyTerminal = async panelId => {
    const previous = await Promise.all((await clipboard.read()).map(async item =>
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
    if (process.env.VIBEBRIDGE_TEST_REOPEN) {
      const saved = JSON.parse(await readFile(`${directory}/expected.json`, 'utf8'));
      await until(async () => (await evaluate('window.workbench.snapshot()')).runs.length === 2);
      const reopened = await evaluate('window.workbench.snapshot()');
      assert.equal(reopened.activeProjectId, saved.activeProjectId);
      assert.deepEqual(reopened.projects, saved.projects);
      assert.deepEqual(reopened.settings, saved.settings);
      assert.ok(reopened.runs.every(run => run.projectId === saved.activeProjectId && !saved.runs.some(old => old.id === run.id)));
      window.setSize(820, 580);
      await until(() => evaluate(`document.querySelectorAll('.xterm').length === 2`));
      assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects, saved.projects);
      await until(() => evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea')`));
      const freshPanel = saved.projects.find(project => project.id === saved.activeProjectId).panels[1].id;
      const freshRun = reopened.runs.find(run => run.panelId === freshPanel);
      await evaluate(`window.observedOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output') window.observedOutput.push(event); }); void 0;`);
      await evaluate(`window.workbench.sendInput(${JSON.stringify(freshRun.id)}, 'fresh-check')`);
      await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:fresh-check'))`));
      let freshText;
      await until(async () => { freshText = await copyTerminal(freshPanel); return freshText.includes('INPUT:fresh-check'); });
      assert.match(freshText, /READY:/);
      assert.doesNotMatch(freshText, /background-check|BACKGROUND:completed|INPUT:z/);
      const other = saved.projects.find(project => project.id !== saved.activeProjectId && project.panels.length);
      await click(other.name);
      await until(async () => (await evaluate('window.workbench.snapshot()')).runs.length === 3);
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      await click(saved.projects.find(project => project.id === saved.activeProjectId).name);
      await click(other.name);
      assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, runs);
      const empty = saved.projects.find(project => !project.panels.length);
      await click(empty.name);
      await until(() => evaluate(`!!document.querySelector('.empty button')`));
      assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, runs);
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try {
          for (const run of runs) assert.throws(() => process.kill(run.pid, 0));
          console.log('Desktop reopen, lazy project startup, saved layouts and empty project passed.');
          app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
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
    const project = before.projects[0];
    const layout = { axis: 'column', ratio: 0.65, first: { panel: project.panels[2].id },
      second: { axis: 'row', ratio: 0.4, first: { panel: project.panels[0].id }, second: { panel: project.panels[1].id } } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(project.id)}, ${JSON.stringify(layout)})`);
    await until(() => evaluate(`document.querySelector('[data-panel-id="${project.panels[2].id}"]').style.height === '65%'`));
    // Exercise the same DOM drag handlers without treating this as a drag-feel or visual acceptance test.
    await evaluate(`window.panelDrag = new DataTransfer(); document.querySelector('[data-panel-id="${project.panels[0].id}"] .panel-header').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.panelDrag }));`);
    await evaluate(`document.querySelector('[data-panel-id="${project.panels[1].id}"] .terminal-container').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.panelDrag }));`);
    await until(() => evaluate(`!!document.querySelector('.drop-target')`));
    await evaluate(`document.querySelector('[data-panel-id="${project.panels[1].id}"] .terminal-container').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.panelDrag }));`);
    const swapped = { ...layout, second: { ...layout.second, first: layout.second.second, second: layout.second.first } };
    await until(async () => JSON.stringify((await evaluate('window.workbench.snapshot()')).projects[0].layout) === JSON.stringify(swapped));
    assert.equal(await evaluate(`!!document.querySelector('.drop-target')`), false);
    const firstPanel = `[data-panel-id="${project.panels[0].id}"]`;
    await evaluate(`document.querySelector('${firstPanel} button[aria-label="放大面板"]').click()`);
    await until(() => evaluate(`!!document.querySelector('${firstPanel} button[aria-label="还原面板"]')`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects[0].layout, swapped);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'm' });
    await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:m'))`));
    assert.deepEqual(await evaluate(`[...new Set(window.observedOutput.filter(event => event.data.includes('INPUT:m')).map(event => event.runId))]`), [before.runs.find(run => run.panelId === project.panels[0].id).id]);
    await click('还原面板');
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects[0].layout, swapped);
    await evaluate(`document.querySelector('${firstPanel} .panel-header').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.panelDrag }));`);
    await evaluate(`document.querySelector('[data-panel-id="${project.panels[1].id}"] .agent-panel').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.panelDrag }));`);
    await until(() => evaluate(`!!document.querySelector('.drop-target')`));
    await evaluate(`window.dispatchEvent(new Event('blur'))`);
    await until(() => evaluate(`!document.querySelector('.drop-target')`));
    const divider = await evaluate(`(() => { const b = document.querySelector('.divider[aria-orientation="horizontal"]').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...divider, button: 'left', clickCount: 1 });
    await until(() => evaluate(`document.querySelector('.canvas').classList.contains('resizing')`));
    window.webContents.sendInputEvent({ type: 'mouseMove', x: divider.x, y: divider.y - 40, modifiers: ['leftButtonDown'] });
    await until(() => evaluate(`document.querySelector('.panel-slot').style.height !== '35%'`));
    window.webContents.sendInputEvent({ type: 'mouseUp', x: divider.x, y: divider.y - 40, button: 'left', clickCount: 1 });
    await until(async () => (await evaluate('window.workbench.snapshot()')).projects[0].layout.ratio !== swapped.ratio);
    const resized = (await evaluate('window.workbench.snapshot()')).projects[0].layout;
    assert.deepEqual(resized.second, swapped.second);
    const movedDivider = { x: divider.x, y: divider.y - 40 };
    window.webContents.sendInputEvent({ type: 'mouseDown', ...movedDivider, button: 'left', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseMove', x: divider.x, y: divider.y - 70, modifiers: ['leftButtonDown'] });
    await until(() => evaluate(`document.querySelector('.canvas').classList.contains('resizing')`));
    await evaluate(`window.dispatchEvent(new Event('blur'))`);
    window.webContents.sendInputEvent({ type: 'mouseUp', x: divider.x, y: divider.y - 70, button: 'left', clickCount: 1 });
    await until(() => evaluate(`!document.querySelector('.canvas').classList.contains('resizing')`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects[0].layout, resized);
    await click('添加项目');
    await click('取消');
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.map(run => run.id), before.runs.map(run => run.id));
    await click('添加 Agent');
    await until(() => evaluate(`!!document.querySelector('dialog[open]')`));
    assert.equal(await evaluate(`document.querySelectorAll('.agent-option').length`), 3);
    await evaluate(`document.querySelector('.agent-option.codex').click()`);
    await until(() => evaluate(`!document.querySelector('dialog') && document.querySelectorAll('.xterm').length === 4`));
    const added = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(added.runs.filter(run => before.runs.some(old => old.id === run.id)), before.runs);
    await evaluate(`document.querySelector('${firstPanel} .panel-header').click()`);
    await evaluate(`window.workbench.closePanel(${JSON.stringify(project.id)}, ${JSON.stringify(project.panels[0].id)})`);
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(project.panels[1].id)}`));
    for (const panel of added.projects[0].panels.slice(1)) await evaluate(`window.workbench.closePanel(${JSON.stringify(project.id)}, ${JSON.stringify(panel.id)})`);
    await until(() => evaluate(`!!document.querySelector('.empty button')`));
    assert.equal(confirmations, 0);
    assert.equal((await evaluate('window.workbench.snapshot()')).projects[0].layout, null);
    await click('＋ 添加 Agent');
    await until(() => evaluate(`!!document.querySelector('dialog[open]')`));
    await evaluate(`document.querySelector('.agent-option.pi').click()`);
    await until(() => evaluate(`!document.querySelector('dialog') && document.querySelectorAll('.xterm').length === 1`));
    assert.equal(await evaluate(`document.querySelector('[role="alert"]')?.textContent ?? ''`), '');
    const secondDirectory = resolve(directory, 'second-project');
    const emptyDirectory = resolve(directory, 'empty-project');
    await mkdir(secondDirectory);
    await mkdir(emptyDirectory);
    const create = (name, path, total) => evaluate(`window.workbench.createProject(${JSON.stringify({ name, directory: path, total, counts: { codex: total, claude: 0, pi: 0 } })})`);
    const { project: second } = await create('Second project', secondDirectory, 2);
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 2`));
    const selectedPanel = second.panels[1].id;
    await evaluate(`document.querySelector('[data-panel-id="${selectedPanel}"] .panel-header').click()`);
    const secondLayout = { axis: 'row', ratio: 0.35, first: { panel: selectedPanel }, second: { panel: second.panels[0].id } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(second.id)}, ${JSON.stringify(secondLayout)})`);
    const projectRuns = (await evaluate('window.workbench.snapshot()')).runs;
    const selectedRun = projectRuns.find(run => run.panelId === selectedPanel);
    await until(() => evaluate(`window.observedOutput.some(event => event.runId === ${JSON.stringify(selectedRun.id)} && event.data.includes('READY:'))`));
    await evaluate(`window.workbench.sendInput(${JSON.stringify(selectedRun.id)}, 'later')`);
    await click('折叠项目导航');
    await click(project.name);
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 1`));
    await evaluate(`window.workbench.sendInput(${JSON.stringify(selectedRun.id)}, 'background-check')`);
    await until(() => evaluate(`window.observedOutput.some(event => event.runId === ${JSON.stringify(selectedRun.id)} && event.data.includes('INPUT:background-check'))`));
    await until(() => evaluate(`window.observedOutput.some(event => event.runId === ${JSON.stringify(selectedRun.id)} && event.data.includes('BACKGROUND:completed'))`));
    window.minimize();
    window.restore();
    await click(second.name);
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 2`));
    assert.equal(await evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId`), selectedPanel);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'z' });
    await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:z'))`));
    assert.deepEqual(await evaluate(`[...new Set(window.observedOutput.filter(event => event.data.includes('INPUT:z')).map(event => event.runId))]`), [selectedRun.id]);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, projectRuns);
    const retainedText = await copyTerminal(selectedPanel);
    assert.match(retainedText, /READY:/);
    assert.match(retainedText, /BACKGROUND:completed/);
    assert.match(retainedText, /INPUT:background-check/);
    await click('添加项目');
    await click('取消');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(selectedPanel)}`));
    await click('展开项目导航');
    const { project: empty } = await create('Empty project', emptyDirectory, 1);
    await evaluate(`window.workbench.closePanel(${JSON.stringify(empty.id)}, ${JSON.stringify(empty.panels[0].id)})`);
    await click(second.name);
    const saved = await evaluate('window.workbench.snapshot()');
    await writeFile(`${directory}/expected.json`, JSON.stringify(saved));
    const quitRuns = (await evaluate('window.workbench.snapshot()')).runs;
    window.close();
    await until(() => confirmations === 1);
    assert.equal(window.isDestroyed(), false);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, quitRuns);
    answer = 1;
    app.once('will-quit', event => {
      event.preventDefault();
      void (async () => {
        for (const run of quitRuns) assert.throws(() => process.kill(run.pid, 0));
        console.log('Desktop creation, panel operations, swap, maximize, native input, remount and quit passed.');
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
