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
  const command = { command: 'node', args: [resolve('tests/fixtures/interactive.cjs'), ...(process.env.VIBEBRIDGE_TEST_SETUP ? ['--encode-cwd'] : [])] };
  const codexCommand = process.env.VIBEBRIDGE_TEST_CODEX ? { command: 'codex', args: ['resume', '--no-daemon', '--no-alt-screen'] } : command;
  if (!process.env.VIBEBRIDGE_TEST_REOPEN) await writeFile(`${directory}/settings.json`, process.env.VIBEBRIDGE_TEST_NOTICE_STARTUP ? '{damaged configuration' : JSON.stringify({ theme: process.env.VIBEBRIDGE_TEST_APPEARANCE ? 'dark' : 'light', agents: { codex: codexCommand, claude: command, pi: command }, ...(process.env.VIBEBRIDGE_TEST_SETTINGS_MIGRATION ? { shortcuts: { previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+Shift+W', maximizePanel: 'Command+Enter', addPanel: 'Command+N', settings: 'Command+,' } } : {}) }));
  let answer = 0;
  let confirmations = 0;
  dialog.showMessageBox = async (_window, options) => {
    if (options.type === 'error') {
      if (process.env.VIBEBRIDGE_TEST_NOTICE_STARTUP) { assert.match(options.detail, /配置读取失败/); return { response: 0 }; }
      throw new Error(options.detail);
    }
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
    if (process.env.VIBEBRIDGE_TEST_NOTICE_STARTUP) {
      await require('./notices-startup-desktop.cjs')({ evaluate, click, until, directory });
      answer = 1;
      app.once('will-quit', event => { event.preventDefault(); app.exit(0); });
      app.quit();
      return;
    }
    if (process.env.VIBEBRIDGE_TEST_NAVIGATION || process.env.VIBEBRIDGE_TEST_SETTINGS_DRAFTS || process.env.VIBEBRIDGE_TEST_SETTINGS_MIGRATION) {
      const result = await require(process.env.VIBEBRIDGE_TEST_SETTINGS_MIGRATION ? './settings-migration-desktop.cjs' : process.env.VIBEBRIDGE_TEST_SETTINGS_DRAFTS ? './settings-drafts-desktop.cjs' : './navigation-desktop.cjs')({ window, evaluate, click, fill, until, directory, reopen: !!process.env.VIBEBRIDGE_TEST_REOPEN });
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try {
          for (const run of runs) if (run.pid) assert.throws(() => process.kill(run.pid, 0));
          if (result?.settingsBeforeQuit) {
            assert.deepEqual(JSON.parse(require('node:fs').readFileSync(`${directory}/settings.json`, 'utf8')), result.settingsBeforeQuit);
            assert.equal(confirmations, 1, 'quit retains its one native confirmation and drops settings drafts');
          }
          app.exit(0);
        }
        catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
    if (process.env.VIBEBRIDGE_TEST_SETUP || process.env.VIBEBRIDGE_TEST_PROJECT_MANAGEMENT) {
      await require(process.env.VIBEBRIDGE_TEST_PROJECT_MANAGEMENT ? './project-management-desktop.cjs' : './setup-desktop.cjs')({ window, evaluate, click, fill, until, directory, dialog });
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try { for (const run of runs) assert.throws(() => process.kill(run.pid, 0)); app.exit(0); }
        catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
    if (process.env.VIBEBRIDGE_TEST_CODEX) {
      await require('./codex-desktop.cjs')({ window, evaluate, click, fill, until, directory });
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try {
          for (const run of runs) assert.throws(() => process.kill(run.pid, 0));
          console.log('Codex native resume picker arrows, focus changes and quit passed.');
          app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
    if (process.env.VIBEBRIDGE_TEST_REOPEN && process.env.VIBEBRIDGE_TEST_PANELS) {
      const saved = JSON.parse(await readFile(`${directory}/panels-expected.json`, 'utf8'));
      await require('./panels-desktop.cjs').reopen({ evaluate, until, saved });
      const runs = (await evaluate('window.workbench.snapshot()')).runs;
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try { for (const run of runs) assert.throws(() => process.kill(run.pid, 0)); app.exit(0); }
        catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
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
    await fill('project-directory', `${directory}/missing`);
    await until(() => evaluate(`document.querySelector('.directory-status').textContent.includes('请选择有效的本地目录')`));
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    await click('选择本地目录');
    await until(() => evaluate(`document.getElementById('project-name').value === ${JSON.stringify(directory.split('/').at(-1))}`));
    await fill('project-name', 'First project');
    await fill('project-directory', `${directory}/missing-again`);
    await until(() => evaluate(`document.querySelector('.directory-status').textContent.includes('请选择有效的本地目录')`));
    assert.equal(await evaluate(`document.getElementById('project-name').value`), 'First project');
    await fill('project-directory', directory);
    for (const label of ['增加Codex', '增加Claude Code', '增加pi']) await click(label);
    await click('取消');
    assert.equal((await evaluate('window.workbench.snapshot()')).projects.length, 0);
    await click('创建项目');
    assert.match(await evaluate('document.body.innerText'), /已分配 3 \/ 3/);
    assert.equal(await evaluate(`document.getElementById('project-directory').value`), directory);
    assert.equal(await evaluate(`document.getElementById('project-name').value`), 'First project');
    await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
    await click('减少窗口数量');
    assert.match(await evaluate('document.body.innerText'), /多分配了 1 个/);
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
    await click('增加窗口数量');
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), false, 'Restoring the total must enable creation on the same page');
    await evaluate(`window.observedOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output' && !window.loadActive) window.observedOutput.push(event); }); void 0;`);
    await click('创建并启动');
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
    const before = await evaluate('window.workbench.snapshot()');
    assert.equal(before.runs.length, 3);
    assert.equal(before.projects[0].name, 'First project');
    assert.equal(before.projects[0].directory, directory);
    assert.deepEqual(before.projects[0].panels.map(panel => panel.agent), ['codex', 'claude', 'pi']);
    await until(() => evaluate(`new Set(window.observedOutput.filter(event => event.data.includes('READY:')).map(event => event.runId)).size === 3`));
    if (process.env.VIBEBRIDGE_TEST_PANELS) {
      await require('./panels-desktop.cjs')({ window, evaluate, until, project: before.projects[0], runs: before.runs, directory, copyTerminal, click });
      await writeFile(`${directory}/panels-expected.json`, JSON.stringify(await evaluate('window.workbench.snapshot()')));
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try { for (const run of before.runs) assert.throws(() => process.kill(run.pid, 0)); app.exit(0); }
        catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
    if (process.env.VIBEBRIDGE_TEST_APPEARANCE) {
      await require('./appearance-desktop.cjs')({ window, evaluate, until, run: before.runs[0] });
      answer = 1;
      app.once('will-quit', event => {
        event.preventDefault();
        try {
          for (const run of before.runs) assert.throws(() => process.kill(run.pid, 0));
          console.log('Dark terminal appearance and quit passed.');
          app.exit(0);
        } catch (error) { console.error(error); app.exit(1); }
      });
      app.quit();
      return;
    }
    const nextDirectory = resolve(directory, 'next-project');
    await mkdir(nextDirectory);
    await click('添加项目');
    assert.equal(await evaluate(`document.getElementById('project-name').value`), '');
    assert.match(await evaluate('document.body.innerText'), /已分配 0 \/ 3/);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextDirectory] });
    await click('选择本地目录');
    await until(() => evaluate(`document.getElementById('project-directory').value === ${JSON.stringify(nextDirectory)}`));
    assert.equal(await evaluate(`document.getElementById('project-directory').value`), nextDirectory);
    await until(() => evaluate(`!document.querySelector('.directory-status').textContent.includes('检查目录')`));
    assert.equal(await evaluate(`document.getElementById('project-name').value`), 'next-project', 'A fresh draft must derive its name from the directory after a named project was created');
    await fill('project-name', 'Pending draft');
    await fill('project-directory', directory);
    await until(() => evaluate(`document.querySelector('.directory-status').textContent.includes('打开已有项目')`));
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
    await click('打开已有项目');
    await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, before.runs);
    await click('添加项目');
    assert.equal(await evaluate(`document.getElementById('project-name').value`), 'Pending draft');
    await fill('project-directory', nextDirectory);
    assert.equal(await evaluate(`document.getElementById('project-name').value`), 'Pending draft');
    await click('取消');
    window.focus();
    window.webContents.focus();
    await evaluate(`document.querySelector('.xterm-helper-textarea').focus()`);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:k'))`));
    const inputRuns = await evaluate(`[...new Set(window.observedOutput.filter(event => event.data.includes('INPUT:k')).map(event => event.runId))]`);
    assert.equal(inputRuns.length, 1);
    const project = before.projects[0];
    await verifyArrows(project.panels[0].id);
    await evaluate(`document.querySelector('[data-panel-id="${project.panels[1].id}"] .panel-header').click()`);
    await verifyArrows(project.panels[1].id);
    await click('全局设置');
    await click('‹ 返回');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(project.panels[1].id)}`));
    await verifyArrows(project.panels[1].id);
    const layout = { axis: 'column', ratio: 0.65, first: { panel: project.panels[2].id },
      second: { axis: 'row', ratio: 0.4, first: { panel: project.panels[0].id }, second: { panel: project.panels[1].id } } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(project.id)}, ${JSON.stringify(layout)})`);
    await until(() => evaluate(`document.querySelector('[data-panel-id="${project.panels[2].id}"]').style.height === '65%'`));
    const dragPanel = async (sourceId, targetId, release = true) => {
      await evaluate('new Promise(resolve => setTimeout(() => requestAnimationFrame(resolve), 250))');
      const point = selector => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(b.left + Math.min(30, b.width / 2)), y: Math.round(b.top + Math.min(12, b.height / 2)) }; })()`);
      const source = await point(`[data-panel-id="${sourceId}"] .panel-header`);
      const target = await point(`[data-panel-id="${targetId}"] .agent-panel`);
      window.webContents.sendInputEvent({ type: 'mouseDown', ...source, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: source.x + 12, y: source.y + 2, modifiers: ['leftButtonDown'] });
      await until(() => evaluate(`!!document.querySelector('.panel-drag-image')`));
      window.webContents.sendInputEvent({ type: 'mouseMove', ...target, modifiers: ['leftButtonDown'] });
      await until(() => evaluate(`!!document.querySelector('.panel-swap-preview')`));
      if (release) window.webContents.sendInputEvent({ type: 'mouseUp', ...target, button: 'left', clickCount: 1 });
      return target;
    };
    await dragPanel(project.panels[0].id, project.panels[1].id);
    const swapped = { ...layout, second: { ...layout.second, first: layout.second.second, second: layout.second.first } };
    await until(async () => JSON.stringify((await evaluate('window.workbench.snapshot()')).projects[0].layout) === JSON.stringify(swapped));
    assert.equal(await evaluate(`!!document.querySelector('.panel-swap-preview')`), false);
    const firstPanel = `[data-panel-id="${project.panels[0].id}"]`;
    await evaluate(`document.querySelector('${firstPanel} button[aria-label="放大面板"]').click()`);
    await until(() => evaluate(`!!document.querySelector('${firstPanel} button[aria-label="还原面板"]')`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects[0].layout, swapped);
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'm' });
    await until(() => evaluate(`window.observedOutput.some(event => event.data.includes('INPUT:m'))`));
    assert.deepEqual(await evaluate(`[...new Set(window.observedOutput.filter(event => event.data.includes('INPUT:m')).map(event => event.runId))]`), [before.runs.find(run => run.panelId === project.panels[0].id).id]);
    await click('还原面板');
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects[0].layout, swapped);
    const cancelledTarget = await dragPanel(project.panels[0].id, project.panels[1].id, false);
    await evaluate(`window.dispatchEvent(new Event('blur'))`);
    window.webContents.sendInputEvent({ type: 'mouseUp', ...cancelledTarget, button: 'left', clickCount: 1 });
    await until(() => evaluate(`!document.querySelector('.panel-swap-preview')`));
    const divider = await evaluate(`(() => { const b = document.querySelector('.divider[aria-orientation="horizontal"]').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...divider, button: 'left', clickCount: 1 });
    await until(() => evaluate(`document.querySelector('.canvas').classList.contains('resizing')`));
    window.webContents.sendInputEvent({ type: 'mouseMove', x: divider.x, y: divider.y - 40, modifiers: ['leftButtonDown'] });
    await until(() => evaluate(`document.querySelector('.panel-slot').style.height !== '35%'`));
    window.webContents.sendInputEvent({ type: 'mouseUp', x: divider.x, y: divider.y - 40, button: 'left', clickCount: 1 });
    await until(async () => (await evaluate('window.workbench.snapshot()')).projects[0].layout.ratio !== swapped.ratio);
    const resized = (await evaluate('window.workbench.snapshot()')).projects[0].layout;
    assert.deepEqual(resized.second, swapped.second);
    // Let the saved-layout snapshot reach React before starting another gesture.
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
    const exitedDirectory = resolve(directory, 'exited-project');
    await mkdir(secondDirectory);
    await mkdir(emptyDirectory);
    await mkdir(exitedDirectory);
    const create = (name, path, total) => evaluate(`window.workbench.createProject(${JSON.stringify({ name, directory: path, total, counts: { codex: total, claude: 0, pi: 0 } })})`);
    // A CLI that exits while a leftover child resists SIGTERM keeps its panel visible during cleanup.
    const { project: exited } = await create('Exited project', exitedDirectory, 1);
    const exitedPanel = `[data-panel-id="${exited.panels[0].id}"]`;
    await until(() => evaluate(`!!document.querySelector('${exitedPanel} .xterm')`));
    const exitedRun = (await evaluate('window.workbench.snapshot()')).runs.find(run => run.panelId === exited.panels[0].id);
    const exitedOutput = text => evaluate(`window.observedOutput.filter(event => event.runId === ${JSON.stringify(exitedRun.id)}).map(event => event.data).join('').match(${text})?.[1] ?? ''`);
    await until(async () => !!(await exitedOutput('/(READY):/')));
    await evaluate(`window.workbench.sendInput(${JSON.stringify(exitedRun.id)}, 'linger')`);
    await until(async () => !!(await exitedOutput('/LINGER:(\\d+)/')));
    const lingerPid = Number(await exitedOutput('/LINGER:(\\d+)/'));
    await new Promise(resolve => setTimeout(resolve, 700));
    await evaluate(`document.querySelector('${exitedPanel} .xterm-helper-textarea').focus()`);
    await evaluate(`window.workbench.sendInput(${JSON.stringify(exitedRun.id)}, 'exit')`);
    await until(() => { try { process.kill(exitedRun.pid, 0); return false; } catch { return true; } });
    assert.equal(await evaluate(`!!document.querySelector('${exitedPanel}')`), true);
    for (const keyCode of ['a', 'b', 'c']) window.webContents.sendInputEvent({ type: 'char', keyCode });
    await until(() => evaluate(`!document.querySelector('${exitedPanel}')`));
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await evaluate(`document.querySelector('[role="alert"]')?.textContent ?? ''`), '');
    assert.throws(() => process.kill(lingerPid, 0));
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
    await until(() => evaluate(`document.querySelector('nav[aria-label="项目导航"]').getBoundingClientRect().width === 0`));
    await click('展开项目导航');
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
    await verifyArrows(selectedPanel);
    await require('./settings-desktop.cjs')({ window, evaluate, click, fill, until });
    await require('./load-desktop.cjs')({ window, evaluate, click, until });
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
    app.quit();
    await until(() => confirmations === 2);
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
