const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { runsOf, storedProjects } = require('./support/panel-views.cjs');

const visiblePanels = evaluate => evaluate('[...document.querySelectorAll(".canvas [data-panel-id]")].filter(panel => panel.checkVisibility({ visibilityProperty: true })).length');

module.exports = {
  async run(context) {
    const { evaluate, until, click, window, directory } = context;
    const summaryShown = () => evaluate('!!document.querySelector(".project-summary")');
    assert.equal(await summaryShown(), false, 'the project creation guide shows no summary');
    const f = await require('./support/summary.cjs')(context);
    const [first, second, third] = f.runs;
    const initial = await f.snapshot();
    const project = initial.projects.find(project => project.id === f.projectId);
    const layout = { axis: 'row', ratio: .3, first: { panel: first.panelId },
      second: { axis: 'column', ratio: .4, first: { panel: second.panelId }, second: { panel: third.panelId } } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(f.projectId)}, ${JSON.stringify(layout)})`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".summary-entry")].map(button => button.textContent)'), ['0 Ready', '1 Needs input', '2 Done', '0 Error']);
    await f.choose('done', second); await f.receiveInput(second, 'split-selection');
    assert.equal(await visiblePanels(evaluate), 3);
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] button[aria-label="Maximize panel"]').click()`);
    await f.choose('done', second); await f.receiveInput(second, 'maximized-selection');
    assert.equal(await visiblePanels(evaluate), 1);
    // The summary belongs to the workspace and leaves with it.
    await click('Global settings');
    assert.equal(await summaryShown(), false, 'the settings page shows no summary');
    await click('‹ Back');
    await until(summaryShown, 'project summary shown after leaving settings');
    await click('Restore panel');
    await f.choose('done', first); await f.receiveInput(first, 'restored-split-selection');
    assert.equal(await visiblePanels(evaluate), 3);

    // A newer list selection supersedes a target that is visible but cannot yet
    // receive terminal input. Hiding only the terminal models delayed layout.
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = 'none'`);
    await f.choose('done', first);
    await until(() => evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'), 'locating waits for the hidden first terminal');
    await f.choose('done', second); await f.receiveInput(second, 'newer-selection');
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = ''`);
    await until(async () => await f.focused(second) && !(await evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")')),
      'second terminal keeps focus and no location waits once the first terminal is shown again');
    // Earlier output remains accessible through terminal scrollback: each Shift+PageUp shows earlier rows
    // until the record is in view. At the top of the scrollback the rows stop changing and the wait fails.
    const rowsText = () => evaluate(`document.querySelector('[data-panel-id="${second.panelId}"] .xterm-rows').textContent`);
    while (!(await rowsText()).includes('RECEIVED:split-selection')) {
      const shown = await rowsText();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageUp', modifiers: ['shift'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageUp', modifiers: ['shift'] });
      await until(async () => await rowsText() !== shown, 'RECEIVED:split-selection in scrollback: Shift+PageUp shows earlier rows until it is in view');
    }
    const unchanged = await f.snapshot();
    assert.deepEqual(runsOf(unchanged).map(run => [run.id, run.pid]), runsOf(initial).map(run => [run.id, run.pid]));
    assert.deepEqual(unchanged.projects[0].layout, layout);

    // Background projects keep updating navigation while the summary follows
    // project navigation. A project-title visit retains its saved viewing mode.
    const otherDirectory = `${directory}/other`; await mkdir(otherDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Other summary project', directory: otherDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`);
    await click('Other summary project');
    await f.send(third, { payload: { hook_event_name: 'Stop' } });
    await until(() => evaluate(`document.querySelector('[data-locate-panel-id="${third.panelId}"] .processing-status')?.getAttribute('aria-label') === 'Done'`), 'navigation shows Done for the background project panel');
    assert.equal(await evaluate('document.querySelectorAll(".project-summary").length'), 1);
    assert.ok(await evaluate('[...document.querySelectorAll(".summary-entry")].some(button => button.textContent === "0 Done")'));
    await click(project.name);
    await until(() => evaluate('[...document.querySelectorAll(".summary-entry")].some(button => button.textContent === "3 Done")'), 'summary shows "3 Done" after returning');

    // Ten long titles make a scrollable list; many projects cannot add bar rows.
    for (let i = 0; i < 7; i++) {
      const result = await evaluate(`window.workbench.addPanel(${JSON.stringify(f.projectId)}, 'codex')`);
      await f.send(result.launch.run, { payload: { hook_event_name: 'Stop' }, output: `\x1b]2;Long session ${i} ${'title '.repeat(40)} | project\x07` });
    }
    for (let i = 0; i < 8; i++) {
      const path = `${directory}/dense-${i}`; await mkdir(path);
      await evaluate(`window.workbench.createProject(${JSON.stringify({ name: `Dense project ${i} ${'long '.repeat(12)}`, directory: path, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`);
    }
    await click(project.name);
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(() => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`), `interface switched to ${language}`);
      for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        for (const size of [[1280, 860], [640, 480]]) {
          window.setContentSize(...size);
          await until(() => evaluate(`document.documentElement.clientWidth === ${size[0]}`), `window content is ${size[0]}px wide`);
          for (const collapsed of [false, true]) {
            if (collapsed) await click(language === 'en' ? 'Collapse project navigation' : '折叠项目导航');
            await f.open('done');
            // The list drops from the middle of the toolbar, centred under the summary unless the window edge clamps it.
            const geometry = await evaluate(`(() => {
              const bar = document.querySelector('.workspace-toolbar').getBoundingClientRect();
              const summary = document.querySelector('.project-summary').getBoundingClientRect();
              const list = document.querySelector('.summary-list').getBoundingClientRect();
              const scroll = document.querySelector('.summary-list ul');
              const centred = Math.max(8, Math.min(summary.left + (summary.width - list.width) / 2, innerWidth - list.width - 8));
              return {
                contained: list.left >= 0 && list.right <= innerWidth && list.bottom <= innerHeight,
                below: list.top >= bar.bottom && list.top - bar.bottom < 6,
                centred: Math.abs(list.left - centred) < 1,
                scrolling: scroll.scrollHeight > scroll.clientHeight,
                entriesVisible: [...document.querySelectorAll('.summary-entry')].every(entry => {
                  const box = entry.getBoundingClientRect(); return box.left >= bar.left && box.right <= bar.right && box.top >= bar.top && box.bottom <= bar.bottom;
                }) };
            })()`);
            assert.ok(geometry.contained); assert.ok(geometry.below); assert.ok(geometry.centred); assert.ok(geometry.scrolling); assert.ok(geometry.entriesVisible);
            f.nativeKey('Escape');
            await until(() => evaluate('!document.querySelector(".summary-list")'), 'summary list closed by Escape');
            assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), language === 'en' ? '10 Done' : '10 本轮结束');
            if (collapsed) await click(language === 'en' ? 'Expand project navigation' : '展开项目导航');
          }
        }
      }
    }
    // The summary stays centred in the toolbar between an empty left and ＋ on the right. A toolbar too narrow
    // for four names collapses every entry to icon and count together; names remain in each entry's
    // accessible name and tooltip.
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(() => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`), `interface switched to ${language}`);
      for (const [width, collapsed] of [[1280, false], [480, true]]) {
        window.setContentSize(width, 480);
        await until(() => evaluate(`document.documentElement.clientWidth === ${width}`), `window content is ${width}px wide`);
        for (const navigation of ['Collapse project navigation', 'Expand project navigation']) {
          const measure = () => evaluate(`(() => {
            const bar = document.querySelector('.workspace-toolbar').getBoundingClientRect();
            const summary = document.querySelector('.project-summary').getBoundingClientRect();
            const add = document.querySelector('.workspace-toolbar > button').getBoundingClientRect();
            return { centred: Math.abs(summary.left + summary.width / 2 - (bar.left + bar.width / 2)) < 1,
              addAtRight: add.left >= summary.right && add.right <= bar.right,
              text: [...document.querySelector('.workspace-toolbar').childNodes].filter(node => !node.matches?.('.project-summary')).map(node => node.textContent).join(''),
              entries: [...document.querySelectorAll('.summary-entry')].map(entry => {
                const box = entry.getBoundingClientRect();
                return { named: entry.querySelector('.summary-name').checkVisibility(), label: entry.getAttribute('aria-label'), hint: entry.dataset.hint,
                  inside: box.left >= summary.left && box.right <= summary.right && box.top >= bar.top && box.bottom <= bar.bottom };
              }) };
          })()`);
          // The toolbar settles once the navigation change is laid out: the summary centred, entries named as the width allows.
          let toolbar;
          await until(async () => { toolbar = await measure(); return toolbar.centred && toolbar.entries.every(entry => entry.named === !collapsed); },
            `toolbar laid out at ${width}px with entries ${collapsed ? 'collapsed' : 'named'}`, { context: () => `toolbar: ${JSON.stringify(toolbar)}` });
          assert.ok(toolbar.addAtRight);
          assert.equal(toolbar.text, '＋', 'no project name, directory or panel count');
          assert.equal(toolbar.entries.length, 4);
          for (const entry of toolbar.entries) { assert.ok(entry.inside, `${entry.label} at ${width}px`); assert.equal(entry.hint, entry.label); }
          // The next measurement must be of the toolbar beside the toggled navigation.
          const toolbarLeft = () => evaluate('document.querySelector(".workspace-toolbar").getBoundingClientRect().left');
          const left = await toolbarLeft();
          await click(language === 'en' ? navigation : navigation.startsWith('Collapse') ? '折叠项目导航' : '展开项目导航');
          await until(async () => await toolbarLeft() !== left, `toolbar moved with the ${navigation.startsWith('Collapse') ? 'collapsed' : 'expanded'} navigation`);
        }
      }
    }
    window.setContentSize(1280, 860);
    await evaluate('window.workbench.saveSettings({ language: "en" })');
    await until(() => evaluate('document.documentElement.lang === "en"'), 'interface switched to en');
    // Persisted configuration is tested in a second Electron process; temporary
    // maximize must not overwrite the layout, and old runs must not be resumed.
    await evaluate(`document.querySelector('[data-panel-id="${second.panelId}"] button[aria-label="Maximize panel"]').click()`);
    await writeFile(`${directory}/summary-expected.json`, JSON.stringify(await f.snapshot()));
    console.log('Summary lists preserve real input recipients, source viewing mode, records and runs; projection, keyboard, constrained geometry and the four-entry narrow collapse passed.');
  },
  async reopen({ evaluate, until, directory }) {
    const saved = JSON.parse(await readFile(`${directory}/summary-expected.json`, 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(async () => runsOf(await evaluate('window.workbench.snapshot()')).length === active.panels.length, 'reopened project has a run for every panel');
    const current = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(storedProjects(current), storedProjects(saved));
    assert.ok(runsOf(current).every(run => !runsOf(saved).some(old => old.id === run.id)));
    await until(async () => await visiblePanels(evaluate) === active.panels.length, 'reopened layout shows every panel');
    assert.equal(await evaluate(`document.querySelectorAll('.canvas button[aria-label="Restore panel"]').length`), 0);
    console.log('Reopening retained the saved layout, with fresh runs and no persisted temporary maximize.');
  },
};
