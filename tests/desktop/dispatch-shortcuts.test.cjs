const assert = require('node:assert/strict');

/** Presses ⌘ and a letter as the keyboard does. */
const press = (window, keyCode) => {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['meta'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['meta'] });
};

module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, { account: 'octo', repositories: ['octo/desktop'], issues: [
      { number: 7, title: 'Dispatched issue', state: 'OPEN', createdAt: new Date().toISOString(), labels: [], bodyHTML: '<p>Body</p>' },
    ] });
    const snapshot = await require('./support/project.cjs')(base, 'Shortcut project', { Codex: 1 });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { window, evaluate, until, click } = context;
    const project = snapshot.projects[0];
    assert.equal((await evaluate(`window.workbench.editProject(${JSON.stringify(project.id)}, { name: ${JSON.stringify(project.name)},
      directory: ${JSON.stringify(project.directory)}, repository: { forge: 'github', path: 'octo/desktop' } }, false)`)).error, undefined);
    await click('Show the GitHub sidebar');
    await until(() => evaluate('document.querySelector(".forge-row-title")?.textContent === "Dispatched issue"'), 'issue row listed');

    // With focus on the issue's row, ⌘D opens its dispatch menu.
    await click('Dispatched issue');
    await until(() => evaluate('!!document.querySelector(".forge-detail")'), 'issue detail open');
    await evaluate('document.querySelector(".forge-row-title").focus()');
    press(window, 'D');
    await until(() => evaluate('document.activeElement?.getAttribute("aria-label") === "Dispatch #7"'), 'dispatch menu open with focus');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until(() => evaluate('!document.querySelector(".dispatch-menu")'), 'dispatch menu closed');

    // With the issue still selected but focus in the terminal, ⌘D and ⌘L go on to the terminal's input. The workbench
    // stops a key it takes before it gets there, so the terminal receiving the key shows the workbench left it alone.
    await evaluate(`window.terminalKeys = [];
      const input = document.querySelector('.canvas .xterm-helper-textarea');
      input.addEventListener('keydown', event => { if (event.metaKey) window.terminalKeys.push(event.code); });
      input.focus(); void 0;`);
    press(window, 'D');
    press(window, 'L');
    await until(async () => JSON.stringify(await evaluate('window.terminalKeys')) === JSON.stringify(['KeyD', 'KeyL']), 'terminal received ⌘D and ⌘L');
    assert.equal(await evaluate('document.activeElement === document.querySelector(".canvas .xterm-helper-textarea")'), true, 'focus stayed in the terminal');
    console.log('⌘D opened the dispatch menu from the issue row, and went with ⌘L to the terminal while focus was there.');
  },
};
