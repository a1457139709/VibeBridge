const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { Menu, dialog } = require('electron');
const { panelViews, runsOf } = require('./support/panel-views.cjs');
const { localize, t, named } = require('./support/localization.cjs');
const { entryLabel } = require('./support/summary-entries.cjs');

const chinese = localize('zh-CN').t;
const menuLabels = translate => ['VibeBridge', translate('editMenu'), translate('windowMenu')];
const agentTitle = 'Untitled task';

module.exports = {
  async run(context) {
    const { evaluate, until, click, fill, window, directory } = context;
    const f = await require('./support/summary.cjs')(context);
    const [first, second] = f.runs;
    await f.send(first, { output: '\x1b]2;project\x07' });
    await f.send(second, { output: `\x1b]2;${agentTitle} | project\x07` });
    await f.choose('done', first);
    await f.receiveInput(first, 'before-language-change');
    const before = await f.snapshot();
    await evaluate(`window.languageScreens = [...document.querySelectorAll('.terminal-screen')]; void 0;`);

    const pending = JSON.stringify({ id: 'input-across-language', output: 'INPUT-PRESERVED\n' });
    for (const character of pending) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    await until(
      () =>
        evaluate(
          `document.querySelector('[data-panel-id="${first.panelId}"] .xterm-rows').textContent.includes('input-across-language')`,
        ),
      'pending input line drawn in the first panel',
    );
    await click(t('settings'));
    await click(t('agents'));
    await fill('command-codex', `${before.settings.agents.codex.command}-draft`);
    await click(t('general'));
    const selectLanguage = async language => {
      await evaluate(`(() => {
        const input = document.getElementById('interface-language');
        input.value = ${JSON.stringify(language)};
        input.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
    };
    await selectLanguage('zh-CN');
    assert.equal((await f.snapshot()).settings.language, 'en');
    assert.equal(await evaluate('document.documentElement.lang'), 'en');
    await click(t('save'));
    await until(() => evaluate('document.documentElement.lang === "zh-CN"'), 'interface switched to zh-CN');
    assert.equal((await f.snapshot()).settings.language, 'zh-CN');
    assert.ok(
      await evaluate(
        `document.querySelector(".notices").textContent.includes(${JSON.stringify(chinese('settingsSaved'))})`,
      ),
    );
    assert.deepEqual(
      Menu.getApplicationMenu().items.map(item => item.label),
      menuLabels(chinese),
    );
    await click(chinese('agents'));
    assert.equal(
      await evaluate('document.getElementById("command-codex").value'),
      `${before.settings.agents.codex.command}-draft`,
    );
    await click(chinese('discardChanges'));
    await click(chinese('general'));

    const openDialog = dialog.showOpenDialog,
      messageDialog = dialog.showMessageBox;
    let directoryOptions, quitOptions;
    dialog.showOpenDialog = async (_owner, options) => {
      directoryOptions = options;
      return { canceled: true, filePaths: [] };
    };
    dialog.showMessageBox = async (_owner, options) => {
      quitOptions = options;
      return { response: 0 };
    };
    try {
      await evaluate('window.workbench.chooseDirectory()');
      assert.equal(directoryOptions.title, chinese('chooseDirectory'));
      assert.equal(directoryOptions.buttonLabel, chinese('selectDirectory'));
      window.close();
      await until(() => !!quitOptions, 'quit confirmation requested in zh-CN');
      assert.equal(quitOptions.message, chinese('quitQuestion'));
      assert.deepEqual(quitOptions.buttons, [chinese('cancel'), chinese('quit')]);
      await selectLanguage('en');
      await click(chinese('save'));
      await until(() => evaluate('document.documentElement.lang === "en"'), 'interface switched back to en');
      assert.deepEqual(
        Menu.getApplicationMenu().items.map(item => item.label),
        menuLabels(t),
      );
      await evaluate('window.workbench.chooseDirectory()');
      assert.equal(directoryOptions.title, t('chooseDirectory'));
      quitOptions = undefined;
      window.close();
      await until(() => !!quitOptions, 'quit confirmation requested in en');
      assert.equal(quitOptions.message, t('quitQuestion'));
      assert.deepEqual(quitOptions.buttons, [t('cancel'), t('quit')]);
    } finally {
      dialog.showOpenDialog = openDialog;
      dialog.showMessageBox = messageDialog;
    }

    let shown = 'en';
    for (const language of ['zh-CN', 'en', 'zh-CN']) {
      await selectLanguage(language);
      await click(localize(shown).t('save'));
      shown = language;
      await until(async () => (await f.snapshot()).settings.language === language, `saved language is ${language}`);
      assert.deepEqual(
        runsOf(await f.snapshot()).map(run => [run.id, run.pid]),
        runsOf(before).map(run => [run.id, run.pid]),
      );
      assert.deepEqual(
        panelViews(await f.snapshot()).map(panel => panel.status),
        panelViews(before).map(panel => panel.status),
      );
      assert.ok(
        await evaluate(
          'window.languageScreens.every(screen => screen.isConnected && [...document.querySelectorAll(".terminal-screen")].includes(screen))',
        ),
      );
    }
    await click(chinese('back'));
    await until(() => evaluate('!document.querySelector(".settings-page")'), 'settings page closed');
    await f.choose('done', first);
    await until(() => f.focused(first), 'first panel terminal focused after choosing it');
    f.nativeKey('Enter');
    await until(
      () =>
        evaluate(
          `window.summaryOutput[${JSON.stringify(first.id)}].includes(${JSON.stringify('ACK:input-across-language\r\n')})`,
        ),
      'first run acknowledged the input kept across language saves',
    );
    assert.ok(
      await evaluate(
        `document.querySelector('[data-panel-id="${first.panelId}"] .xterm-rows').textContent.includes('RECEIVED:before-language-change')`,
      ),
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-panel-id="${first.panelId}"] .xterm-helper-textarea').getAttribute('aria-label')`,
      ),
      chinese('terminalInput'),
    );
    assert.deepEqual((await f.snapshot()).projects, before.projects);
    await f.open('done');
    assert.equal(
      await evaluate(`document.querySelector('.summary-list [data-run-id="${first.id}"] .session-title').textContent`),
      chinese('untitled'),
    );
    assert.equal(
      await evaluate(`document.querySelector('.summary-list [data-run-id="${second.id}"] .session-title').textContent`),
      agentTitle,
    );
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(
        () => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`),
        `interface switched to ${language}`,
      );
      assert.ok(
        await evaluate(`(() => {
        const list = document.querySelector('.summary-list').getBoundingClientRect();
        const summary = document.querySelector('.project-summary').getBoundingClientRect();
        const centred = Math.max(8, Math.min(summary.left + (summary.width - list.width) / 2, innerWidth - list.width - 8));
        return Math.abs(list.left - centred) < 1;
      })()`),
      );
    }
    f.nativeKey('Escape');
    await until(() => evaluate('!document.querySelector(".summary-list")'), 'summary list closed by Escape');
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), entryLabel('done', 2, 'zh-CN'));
    assert.equal(JSON.parse(await readFile(`${directory}/settings.json`, 'utf8')).language, 'zh-CN');
    console.log(
      'Language saves preserve live terminal input, records, run identities and drafts; native dialogs and menus agree.',
    );
  },
  async reopen({ evaluate, until }) {
    await until(
      () => evaluate('document.documentElement.lang === "zh-CN" && !!document.querySelector(".workspace")'),
      'reopened workspace drawn in zh-CN',
    );
    assert.equal((await evaluate('window.workbench.fetchSnapshot()')).settings.language, 'zh-CN');
    assert.deepEqual(
      Menu.getApplicationMenu().items.map(item => item.label),
      menuLabels(chinese),
    );
    assert.ok(await evaluate(`!!document.querySelector(${named('button', chinese('settings'))})`));
  },
};
