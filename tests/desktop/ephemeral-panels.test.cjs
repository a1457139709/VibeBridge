const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

const frames = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';

module.exports = {
  async run(context) {
    const { window, evaluate, until, click } = context;
    await evaluate('window.output = {}; window.workbench.subscribe(event => { if (event.kind === "output") window.output[event.runId] = (window.output[event.runId] || "") + event.data; }); void 0;');
    const created = await require('./support/project.cjs')(context, 'Ephemeral panels', { Codex: 2 });
    const project = created.projects[0];
    const residentRuns = runsOf(created);
    const layout = project.layout;
    const snapshot = () => evaluate('window.workbench.snapshot()');
    const tray = async () => (await snapshot()).projects[0].tray;
    const nativeKey = keyCode => {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
    };
    const focusedPanel = () => evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') ? document.activeElement.closest('[data-panel-id]')?.dataset.panelId : undefined`);
    const visibleResidents = () => evaluate(`${JSON.stringify(project.panels.map(panel => panel.id))}.filter(id => document.querySelector('[data-panel-id="' + id + '"]').checkVisibility({ visibilityProperty: true })).length`);
    const pressed = () => evaluate('[...document.querySelectorAll(".panel-tray .tray-card")].map(card => [card.dataset.trayPanelId, card.getAttribute("aria-pressed")])');
    const addThroughPicker = async (open, agent) => {
      const before = (await tray()).length;
      await open();
      await until(() => evaluate('!!document.querySelector("dialog.agent-picker[open]")'));
      await evaluate(`document.querySelector('dialog.agent-picker .agent-option.${agent}').click()`);
      await until(async () => (await tray()).length === before + 1 && !(await evaluate('!!document.querySelector("dialog.agent-picker[open]")')));
      return (await tray()).at(-1);
    };
    const typeInto = async (panel, text) => {
      await until(async () => await focusedPanel() === panel.id);
      for (const character of text) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await until(() => evaluate(`(window.output[${JSON.stringify(panel.run.id)}] || '').includes(${JSON.stringify(`INPUT:${text.at(-1)}`)})`));
    };

    // A new panel joins the tray and opens at once over the hidden, still mounted resident panels.
    const first = await addThroughPicker(() => click('Add Agent'), 'codex');
    assert.deepEqual((await snapshot()).projects[0].layout, layout);
    assert.deepEqual((await snapshot()).projects[0].panels.map(panel => panel.id), project.panels.map(panel => panel.id));
    await until(async () => JSON.stringify(await pressed()) === JSON.stringify([[first.id, 'true']]));
    await until(async () => await focusedPanel() === first.id);
    assert.equal(await visibleResidents(), 0);
    assert.equal(await evaluate('document.querySelectorAll(".canvas .xterm-rows").length'), 3, 'hidden resident terminals stay mounted');
    await typeInto(first, 'a');

    // The add shortcut behaves as the toolbar button: the new panel opens and the open one returns to the tray.
    const second = await addThroughPicker(() => evaluate('document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "n", code: "KeyN", metaKey: true, bubbles: true }))'), 'pi');
    await until(async () => JSON.stringify(await pressed()) === JSON.stringify([[first.id, 'false'], [second.id, 'true']]));
    await until(async () => await focusedPanel() === second.id);
    await typeInto(second, 'b');
    assert.ok(!(await evaluate(`(window.output[${JSON.stringify(first.run.id)}] || '').includes('INPUT:b')`)));

    // Escape goes to the terminal and does not collapse the open panel.
    await evaluate(`window.output[${JSON.stringify(second.run.id)}] = ''; void 0`);
    nativeKey('Escape');
    await until(() => evaluate(`(window.output[${JSON.stringify(second.run.id)}] || '').includes('BYTES:1b')`));
    await evaluate(frames);
    assert.deepEqual(await pressed(), [[first.id, 'false'], [second.id, 'true']]);

    // Collapse restores the unchanged layout and runs; clicking cards switches and collapses.
    await click('Collapse panel');
    await until(async () => JSON.stringify(await pressed()) === JSON.stringify([[first.id, 'false'], [second.id, 'false']]));
    await until(async () => await visibleResidents() === 2);
    assert.equal(await evaluate('document.querySelectorAll(".canvas [data-panel-id]").length'), 2);
    await evaluate(`document.querySelector('[data-tray-panel-id="${first.id}"]').click()`);
    await until(async () => await focusedPanel() === first.id);
    await typeInto(first, 'c');
    await evaluate(`document.querySelector('[data-tray-panel-id="${first.id}"]').click()`);
    await until(async () => await visibleResidents() === 2);
    assert.deepEqual(await pressed(), [[first.id, 'false'], [second.id, 'false']]);
    const unchanged = await snapshot();
    assert.deepEqual(unchanged.projects[0].layout, layout);
    assert.deepEqual(runsOf(unchanged).slice(0, 2).map(run => run.id), residentRuns.map(run => run.id));

    // Closing the open tray panel ends its run and returns to the resident layout.
    await evaluate(`document.querySelector('[data-tray-panel-id="${second.id}"]').click()`);
    await until(async () => await focusedPanel() === second.id);
    // Hidden resident panels keep their own close buttons; use the open panel's.
    await evaluate(`document.querySelector('[data-panel-id="${second.id}"] button[aria-label="Close panel"]').click()`);
    await until(async () => (await tray()).length === 1);
    await until(async () => await visibleResidents() === 2);
    assert.throws(() => process.kill(second.run.pid, 0));

    // A tray panel whose Agent exits on its own leaves the tray; an open one returns to the layout.
    await evaluate(`document.querySelector('[data-tray-panel-id="${first.id}"]').click()`);
    await until(async () => await focusedPanel() === first.id);
    await evaluate(`window.workbench.sendInput(${JSON.stringify(first.run.id)}, 'exit')`);
    await until(async () => (await tray()).length === 0);
    await until(async () => await visibleResidents() === 2);
    assert.equal(await evaluate('document.querySelectorAll(".panel-tray .tray-card").length'), 0);
    assert.deepEqual((await snapshot()).projects[0].layout, layout);
    // Panel shortcuts follow the resident layout: with a tray panel open they collapse it first.
    const residentIds = project.panels.map(panel => panel.id);
    const shortcut = (code, key, shiftKey = false) => evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, metaKey: true, shiftKey: ${shiftKey}, bubbles: true }))`);
    const third = await addThroughPicker(() => click('Add Agent'), 'codex');
    await until(async () => await focusedPanel() === third.id);
    await shortcut('Enter', 'Enter');
    await until(async () => JSON.stringify(await pressed()) === JSON.stringify([[third.id, 'false']]));
    await until(async () => await visibleResidents() === 2);
    await until(async () => residentIds.includes(await focusedPanel()));
    const selectedResident = await focusedPanel();
    const otherResident = residentIds.find(id => id !== selectedResident);
    await shortcut('Enter', 'Enter');
    await until(async () => await visibleResidents() === 1);
    assert.equal(await focusedPanel(), selectedResident, 'the maximize shortcut still maximizes the selected resident panel');
    await shortcut('Enter', 'Enter');
    await until(async () => await visibleResidents() === 2);

    await evaluate(`document.querySelector('[data-tray-panel-id="${third.id}"]').click()`);
    await until(async () => await focusedPanel() === third.id);
    await shortcut('BracketRight', ']');
    await until(async () => await focusedPanel() === otherResident);
    await until(async () => await visibleResidents() === 2);
    assert.deepEqual(await pressed(), [[third.id, 'false']]);
    await shortcut('BracketLeft', '[');
    await until(async () => await focusedPanel() === selectedResident);
    assert.equal(await visibleResidents(), 2, 'moving between resident panels does not maximize them');

    await evaluate(`document.querySelector('[data-tray-panel-id="${third.id}"]').click()`);
    await until(async () => await focusedPanel() === third.id);
    await shortcut('KeyW', 'W', true);
    await until(async () => (await tray()).length === 0);
    await until(async () => await visibleResidents() === 2);
    assert.equal((await snapshot()).projects[0].panels.length, 2);
    console.log('New panels joined the tray and opened with terminal focus, one at a time; the add shortcut matched the toolbar; Escape reached the terminal without collapsing; collapse and card clicks kept the layout and runs; closing and exiting left the tray; panel shortcuts collapsed an open tray panel and moved only between resident panels.');
  },
};
