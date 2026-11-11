const assert = require('node:assert/strict');

// Presses Command with a key through Chromium's native input path, as the user does.
const press = (window, keyCode) => {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['meta'] });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['meta'] });
};

module.exports = {
  async run(base) {
    await require('./support/gh-double.cjs')(base.directory, { login: 'octo', repositories: ['octo/app'],
      issues: [{ number: 1, title: 'Shortcut issue', state: 'OPEN', stateReason: null, createdAt: '2026-01-01T00:00:00Z', labels: [], author: 'octo', bodyHTML: '<p>Body</p>' }] });
    const context = await require('./support/terminal-waits.cjs')(base);
    const { evaluate, until, click, window } = context;
    const created = await require('./support/project.cjs')(context, 'Shortcut project', { Codex: 1 });
    const project = created.projects[0];
    const panelId = project.panels[0].id;
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'), 'terminal shows READY:');
    await evaluate(`window.workbench.bindRepository(${JSON.stringify(project.id)}, { platform: 'github', path: 'octo/app' })`);
    await click('Open issue sidebar');
    await until(() => evaluate('!!document.querySelector(".issue-row .dispatch-button")'), 'issue row listed with its dispatch button');

    // Within an issue, ⌘D opens its dispatch menu.
    await evaluate('document.querySelector(".issue-row .dispatch-button").focus()');
    press(window, 'D');
    await until(() => evaluate('!!document.activeElement?.closest(".dispatch-menu")'), '⌘D opened the dispatch menu with focus inside it');
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await until(() => evaluate('!document.querySelector(".dispatch-menu")'), 'Escape closed the dispatch menu');

    // With focus in the terminal, both shortcuts reach the terminal as they would without the sidebar. The probe
    // listens at the terminal before xterm does, so a consumed shortcut is one the workbench took.
    const textarea = `document.querySelector('[data-panel-id="${panelId}"] .xterm-helper-textarea')`;
    await evaluate(`window.reached = []; ${textarea}.addEventListener('keydown', event => { if (event.metaKey) window.reached.push(event.code + (event.defaultPrevented ? ' consumed' : '')); }, true); ${textarea}.focus()`);
    press(window, 'D');
    press(window, 'L');
    let reached;
    await until(async () => (reached = await evaluate('window.reached')).length === 2, 'both shortcuts reached the terminal', { context: () => JSON.stringify(reached) });
    assert.deepEqual(reached, ['KeyD', 'KeyL'], 'nothing consumed either shortcut before the terminal');
    assert.equal(await evaluate(`document.activeElement === ${textarea}`), true, 'the terminal keeps focus');
    assert.equal(await evaluate('!!document.querySelector(".dispatch-menu")'), false, 'no dispatch menu opened');
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate('window.output.includes("INPUT:k")'), 'typing after the shortcuts reaches the run');
    console.log('⌘D opened the dispatch menu from an issue row; with focus in the terminal, ⌘D and ⌘L reached the terminal unconsumed.');
  },
};
