const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');

module.exports = {
  async run(context) {
    const { evaluate, until, click, directory } = context;
    const created = await require('./support/project.cjs')(context, 'Navigation tray project', { Codex: 1 });
    const project = created.projects[0];
    const snapshot = () => evaluate('window.workbench.snapshot()');
    const added = await evaluate(`window.workbench.addPanel(${JSON.stringify(project.id)}, 'codex')`);
    const trayPanelId = added.panel.id;
    await until(async () => (await snapshot()).projects[0].tray.length === 1, 'added panel joined the tray');
    const navigation = (await snapshot()).navigation;

    const otherDirectory = `${directory}/other`; await mkdir(otherDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Other navigation project', directory: otherDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`);
    await click('Other navigation project');
    await until(async () => (await snapshot()).activeProjectId !== project.id, 'Other navigation project active');

    // The group starts collapsed; expanding it is not a navigation preference.
    const group = `document.querySelector('[data-project-id="${project.id}"] .ephemeral-toggle')`;
    await until(() => evaluate(`${group}?.getAttribute('aria-expanded') === 'false'`), 'ephemeral group of the tray project collapsed');
    await evaluate(`${group}.click()`);
    await until(() => evaluate(`!!document.querySelector('[data-project-id="${project.id}"] [data-locate-panel-id="${trayPanelId}"]')`), 'expanded ephemeral group lists the tray panel');
    assert.deepEqual((await snapshot()).navigation, navigation);

    // Clicking the entry switches to its project and opens the panel as the ephemeral maximize.
    await evaluate(`document.querySelector('[data-project-id="${project.id}"] [data-locate-panel-id="${trayPanelId}"]').click()`);
    await until(async () => (await snapshot()).activeProjectId === project.id, 'tray panel entry switched back to its project');
    await until(() => evaluate(`document.querySelector('[data-tray-panel-id="${trayPanelId}"]')?.getAttribute('aria-pressed') === 'true'`), 'tray card of the located panel pressed');
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(trayPanelId)}`), 'located tray panel focused');
    const resident = project.panels[0].id;
    await until(() => evaluate(`!document.querySelector('[data-panel-id="${resident}"]').checkVisibility({ visibilityProperty: true })`), 'resident panel hidden behind the open tray panel');
    assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${trayPanelId}"]').getAttribute('aria-current')`), 'true');
    console.log('The navigation listed the tray panel in a collapsed ephemeral group; its entry switched projects and opened the panel as the ephemeral maximize without saving navigation preferences.');
  },
};
