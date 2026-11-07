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
    await until(async () => (await snapshot()).projects[0].tray.length === 1);
    const navigation = (await snapshot()).navigation;

    const otherDirectory = `${directory}/other`; await mkdir(otherDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Other navigation project', directory: otherDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`);
    await click('Other navigation project');
    await until(async () => (await snapshot()).activeProjectId !== project.id);

    // The group starts collapsed; expanding it is not a navigation preference.
    const group = `document.querySelector('[data-project-id="${project.id}"] .ephemeral-toggle')`;
    await until(() => evaluate(`${group}?.getAttribute('aria-expanded') === 'false'`));
    await evaluate(`${group}.click()`);
    await until(() => evaluate(`!!document.querySelector('[data-project-id="${project.id}"] [data-locate-panel-id="${trayPanelId}"]')`));
    assert.deepEqual((await snapshot()).navigation, navigation);

    // Clicking the entry switches to its project and opens the panel as the ephemeral maximize.
    await evaluate(`document.querySelector('[data-project-id="${project.id}"] [data-locate-panel-id="${trayPanelId}"]').click()`);
    await until(async () => (await snapshot()).activeProjectId === project.id);
    await until(() => evaluate(`document.querySelector('[data-tray-panel-id="${trayPanelId}"]')?.getAttribute('aria-pressed') === 'true'`));
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(trayPanelId)}`));
    const resident = project.panels[0].id;
    await until(() => evaluate(`!document.querySelector('[data-panel-id="${resident}"]').checkVisibility({ visibilityProperty: true })`));
    assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${trayPanelId}"]').getAttribute('aria-current')`), 'true');
    console.log('The navigation listed the tray panel in a collapsed ephemeral group; its entry switched projects and opened the panel as the ephemeral maximize without saving navigation preferences.');
  },
};
