const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { Menu, dialog } = require('electron');

module.exports = {
  async run(context) {
    const { evaluate, until, click, fill, window, directory } = context;
    const f = await require('./support/summary.cjs')(context);
    const [first, second] = f.runs;
    await f.send(first, { output: '\x1b]2;project\x07' });
    await f.send(second, { output: '\x1b]2;Untitled task | project\x07' });
    await f.choose('done', first);
    await f.receiveInput(first, 'before-language-change');
    const before = await f.snapshot();
    await evaluate(`window.languageScreens = [...document.querySelectorAll('.terminal-screen')]; void 0;`);

    // Keep an unfinished input line in a real PTY while settings take focus.
    const pending = JSON.stringify({ id: 'input-across-language', output: 'INPUT-PRESERVED\n' });
    for (const character of pending) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    await until(() => evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .xterm-rows').textContent.includes('input-across-language')`));
    await click('Global settings'); await click('Agent');
    await fill('command-codex', `${before.settings.agents.codex.command}-draft`);
    await click('General');
    const selectLanguage = async language => {
      await evaluate(`(() => {
        const input = document.getElementById('interface-language');
        input.value = ${JSON.stringify(language)};
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    };
    await selectLanguage('zh-CN');
    assert.equal((await f.snapshot()).settings.language, 'en');
    assert.ok(await evaluate('document.body.textContent.includes("Interface language")'));
    await click('Save');
    await until(() => evaluate('document.documentElement.lang === "zh-CN"'));
    assert.ok(await evaluate('document.querySelector(".notices").textContent.includes("配置已保存")'));
    assert.deepEqual(Menu.getApplicationMenu().items.map(item => item.label), ['VibeBridge', '编辑', '窗口']);
    await click('Agent');
    assert.equal(await evaluate('document.getElementById("command-codex").value'), `${before.settings.agents.codex.command}-draft`);
    await click('放弃更改'); await click('通用');

    // Native surfaces consume the saved preference. Only the system boundary
    // is intercepted; the production menu and dialog call paths still execute.
    const openDialog = dialog.showOpenDialog, messageDialog = dialog.showMessageBox;
    let directoryOptions, quitOptions;
    dialog.showOpenDialog = async (_owner, options) => { directoryOptions = options; return { canceled: true, filePaths: [] }; };
    dialog.showMessageBox = async (_owner, options) => { quitOptions = options; return { response: 0 }; };
    try {
      await evaluate('window.workbench.chooseDirectory()');
      assert.equal(directoryOptions.title, '选择本地目录');
      assert.equal(directoryOptions.buttonLabel, '选择目录');
      window.close(); await until(() => !!quitOptions);
      assert.equal(quitOptions.message, '退出 VibeBridge？');
      assert.deepEqual(quitOptions.buttons, ['取消', '退出']);
      await selectLanguage('en'); await click('保存');
      await until(() => evaluate('document.documentElement.lang === "en"'));
      assert.deepEqual(Menu.getApplicationMenu().items.map(item => item.label), ['VibeBridge', 'Edit', 'Window']);
      await evaluate('window.workbench.chooseDirectory()');
      assert.equal(directoryOptions.title, 'Choose local directory');
      quitOptions = undefined; window.close(); await until(() => !!quitOptions);
      assert.equal(quitOptions.message, 'Quit VibeBridge?');
      assert.deepEqual(quitOptions.buttons, ['Cancel', 'Quit']);
    } finally { dialog.showOpenDialog = openDialog; dialog.showMessageBox = messageDialog; }

    for (const [language, save] of [['zh-CN', 'Save'], ['en', '保存'], ['zh-CN', 'Save']]) {
      await selectLanguage(language); await click(save);
      await until(async () => (await f.snapshot()).settings.language === language);
      assert.deepEqual((await f.snapshot()).runs.map(run => [run.id, run.pid]), before.runs.map(run => [run.id, run.pid]));
      assert.deepEqual((await f.snapshot()).processing, before.processing);
      assert.ok(await evaluate('window.languageScreens.every(screen => screen.isConnected && [...document.querySelectorAll(".terminal-screen")].includes(screen))'));
    }
    await click('‹ 返回');
    await until(() => evaluate('!document.querySelector(".settings-page")'));
    await f.choose('done', first); await until(() => f.focused(first));
    f.nativeKey('Enter');
    await until(() => evaluate(`window.summaryOutput[${JSON.stringify(first.id)}].includes(${JSON.stringify('ACK:input-across-language\r\n')})`));
    assert.ok(await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .xterm-rows').textContent.includes('RECEIVED:before-language-change')`));
    assert.equal(await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .xterm-helper-textarea').getAttribute('aria-label')`), '终端输入');
    assert.deepEqual((await f.snapshot()).projects, before.projects);
    await f.open('done');
    assert.equal(await evaluate(`document.querySelector('.summary-list [data-run-id="${first.id}"] .session-title').textContent`), '未命名任务');
    assert.equal(await evaluate(`document.querySelector('.summary-list [data-run-id="${second.id}"] .session-title').textContent`), 'Untitled task');
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(() => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`));
      assert.ok(await evaluate(`(() => {
        const list = document.querySelector('.summary-list').getBoundingClientRect();
        const trigger = document.querySelector('.summary-entry[aria-expanded=true]').getBoundingClientRect();
        return Math.abs(list.left - trigger.left) < 1;
      })()`));
    }
    f.nativeKey('Escape');
    await until(() => evaluate('!document.querySelector(".summary-list")'));
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '2 本轮结束');
    assert.equal(JSON.parse(await readFile(`${directory}/settings.json`, 'utf8')).language, 'zh-CN');
    console.log('Language saves preserve live terminal input, records, run identities and drafts; native dialogs and menus agree.');
  },
  async reopen({ evaluate, until }) {
    await until(() => evaluate('document.documentElement.lang === "zh-CN" && !!document.querySelector(".workspace")'));
    assert.equal((await evaluate('window.workbench.snapshot()')).settings.language, 'zh-CN');
    assert.deepEqual(Menu.getApplicationMenu().items.map(item => item.label), ['VibeBridge', '编辑', '窗口']);
    assert.ok(await evaluate('!!document.querySelector("button[aria-label=全局设置]")'));
  },
};
