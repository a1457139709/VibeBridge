const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { runsOf, showing, statusOf, storedProjects } = require('./support/panel-views.cjs');
const { localize, t, named } = require('./support/localization.cjs');
const { summaryStates, summaryEntry, entryLabel, entryLabels } = require('./support/summary-entries.cjs');

const visiblePanels = evaluate =>
  evaluate(
    '[...document.querySelectorAll(".canvas [data-panel-id]")].filter(panel => panel.checkVisibility({ visibilityProperty: true })).length',
  );

module.exports = {
  async run(context) {
    const { evaluate, until, click, window, directory } = context;
    const summaryShown = () => evaluate('!!document.querySelector(".project-summary")');
    assert.equal(await summaryShown(), false, 'the project creation guide shows no summary');
    const f = await require('./support/summary.cjs')(context);
    const [first, second, third] = f.runs;
    const initial = await f.snapshot();
    const project = initial.projects.find(project => project.id === f.projectId);
    const layout = {
      axis: 'row',
      ratio: 0.3,
      first: { panel: first.panelId },
      second: { axis: 'column', ratio: 0.4, first: { panel: second.panelId }, second: { panel: third.panelId } },
    };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(f.projectId)}, ${JSON.stringify(layout)})`);
    const counted = await f.snapshot();
    assert.deepEqual(
      summaryStates.map(state => showing(counted, f.projectId, state).length),
      [0, 1, 2, 0],
    );
    assert.deepEqual(
      await evaluate(
        '[...document.querySelectorAll(".summary-entry")].map(button => button.getAttribute("aria-label"))',
      ),
      entryLabels(counted, f.projectId),
    );
    await f.choose('done', second);
    await f.receiveInput(second, 'split-selection');
    assert.equal(await visiblePanels(evaluate), 3);
    await evaluate(
      `document.querySelector(${named(`[data-panel-id="${first.panelId}"] button`, t('enlargePanel'))}).click()`,
    );
    await f.choose('done', second);
    await f.receiveInput(second, 'maximized-selection');
    assert.equal(await visiblePanels(evaluate), 1);
    await click(t('settings'));
    assert.equal(await summaryShown(), false, 'the settings page shows no summary');
    await click(t('back'));
    await until(summaryShown, 'project summary shown after leaving settings');
    await click(t('restorePanel'));
    await f.choose('done', first);
    await f.receiveInput(first, 'restored-split-selection');
    assert.equal(await visiblePanels(evaluate), 3);

    await evaluate(
      `document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = 'none'`,
    );
    await f.choose('done', first);
    await until(
      () => evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'),
      'locating waits for the hidden first terminal',
    );
    await f.choose('done', second);
    await f.receiveInput(second, 'newer-selection');
    await evaluate(
      `document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = ''`,
    );
    await until(
      async () =>
        (await f.focused(second)) &&
        !(await evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")')),
      'second terminal keeps focus and no location waits once the first terminal is shown again',
    );
    const rowsText = () =>
      evaluate(`document.querySelector('[data-panel-id="${second.panelId}"] .xterm-rows').textContent`);
    while (!(await rowsText()).includes('RECEIVED:split-selection')) {
      const shown = await rowsText();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'PageUp', modifiers: ['shift'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'PageUp', modifiers: ['shift'] });
      await until(
        async () => (await rowsText()) !== shown,
        'RECEIVED:split-selection in scrollback: Shift+PageUp shows earlier rows until it is in view',
      );
    }
    const unchanged = await f.snapshot();
    assert.deepEqual(
      runsOf(unchanged).map(run => [run.id, run.pid]),
      runsOf(initial).map(run => [run.id, run.pid]),
    );
    assert.deepEqual(unchanged.projects[0].layout, layout);

    const otherDirectory = `${directory}/other`;
    await mkdir(otherDirectory);
    await evaluate(
      `window.workbench.createProject(${JSON.stringify({ name: 'Other summary project', directory: otherDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`,
    );
    await click('Other summary project');
    await until(async () => (await f.snapshot()).activeProjectId !== f.projectId, 'other summary project active');
    await f.send(third, { payload: { hook_event_name: 'Stop' } });
    await until(async () => statusOf(await f.snapshot(), third.id) === 'done', 'background project run is done');
    await until(
      () =>
        evaluate(
          `document.querySelector('[data-locate-panel-id="${third.panelId}"] .processing-status')?.getAttribute('aria-label') === ${JSON.stringify(t('done'))}`,
        ),
      'navigation shows the done status for the background project panel',
    );
    const background = await f.snapshot();
    assert.equal(showing(background, background.activeProjectId, 'done').length, 0);
    assert.equal(await evaluate('document.querySelectorAll(".project-summary").length'), 1);
    assert.equal(
      await evaluate(`${summaryEntry('done')}.getAttribute('aria-label')`),
      entryLabel('done', 0),
      'the summary counts the active project only',
    );
    await click(project.name);
    await until(async () => (await f.snapshot()).activeProjectId === f.projectId, 'summary project active again');
    await until(
      async () => showing(await f.snapshot(), f.projectId, 'done').length === 3,
      'summary project has 3 done panels',
    );
    await until(
      () => evaluate(`${summaryEntry('done')}.getAttribute('aria-label') === ${JSON.stringify(entryLabel('done', 3))}`),
      'summary counts 3 done after returning',
    );

    for (let i = 0; i < 7; i++) {
      const result = await evaluate(`window.workbench.addPanel(${JSON.stringify(f.projectId)}, 'codex')`);
      await f.send(result.launch.run, {
        payload: { hook_event_name: 'Stop' },
        output: `\x1b]2;Long session ${i} ${'title '.repeat(40)} | project\x07`,
      });
    }
    for (let i = 0; i < 8; i++) {
      const path = `${directory}/dense-${i}`;
      await mkdir(path);
      await evaluate(
        `window.workbench.createProject(${JSON.stringify({ name: `Dense project ${i} ${'long '.repeat(12)}`, directory: path, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`,
      );
    }
    await click(project.name);
    await until(
      async () => showing(await f.snapshot(), f.projectId, 'done').length === 10,
      'summary project has 10 done panels',
    );
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(
        () => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`),
        `interface switched to ${language}`,
      );
      for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        for (const size of [
          [1280, 860],
          [640, 480],
        ]) {
          window.setContentSize(...size);
          await until(
            () => evaluate(`document.documentElement.clientWidth === ${size[0]}`),
            `window content is ${size[0]}px wide`,
          );
          for (const collapsed of [false, true]) {
            if (collapsed) await click(localize(language).t('collapseNavigation'));
            await f.open('done');
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
            assert.ok(geometry.contained);
            assert.ok(geometry.below);
            assert.ok(geometry.centred);
            assert.ok(geometry.scrolling);
            assert.ok(geometry.entriesVisible);
            f.nativeKey('Escape');
            await until(() => evaluate('!document.querySelector(".summary-list")'), 'summary list closed by Escape');
            assert.equal(
              await evaluate('document.activeElement.getAttribute("aria-label")'),
              entryLabel('done', 10, language),
            );
            if (collapsed) await click(localize(language).t('expandNavigation'));
          }
        }
      }
    }
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(
        () => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`),
        `interface switched to ${language}`,
      );
      for (const [width, collapsed] of [
        [1280, false],
        [480, true],
      ]) {
        window.setContentSize(width, 480);
        await until(
          () => evaluate(`document.documentElement.clientWidth === ${width}`),
          `window content is ${width}px wide`,
        );
        for (const navigation of ['collapseNavigation', 'expandNavigation']) {
          const measure = () =>
            evaluate(`(() => {
            const bar = document.querySelector('.workspace-toolbar').getBoundingClientRect();
            const summary = document.querySelector('.project-summary').getBoundingClientRect();
            const add = document.querySelector('.workspace-toolbar > button').getBoundingClientRect();
            return { centred: Math.abs(summary.left + summary.width / 2 - (bar.left + bar.width / 2)) < 1,
              addAtRight: add.left >= summary.right && add.right <= bar.right,
              others: [...document.querySelector('.workspace-toolbar').childNodes].filter(node => !node.matches?.('.project-summary'))
                .map(node => node.nodeType === Node.ELEMENT_NODE ? node.getAttribute('aria-label') : node.textContent),
              entries: [...document.querySelectorAll('.summary-entry')].map(entry => {
                const box = entry.getBoundingClientRect();
                return { named: entry.querySelector('.summary-name').checkVisibility(), label: entry.getAttribute('aria-label'), hint: entry.dataset.hint,
                  inside: box.left >= summary.left && box.right <= summary.right && box.top >= bar.top && box.bottom <= bar.bottom };
              }) };
          })()`);
          let toolbar;
          await until(
            async () => {
              toolbar = await measure();
              return toolbar.centred && toolbar.entries.every(entry => entry.named === !collapsed);
            },
            `toolbar laid out at ${width}px with entries ${collapsed ? 'collapsed' : 'named'}`,
            { context: () => `toolbar: ${JSON.stringify(toolbar)}` },
          );
          assert.ok(toolbar.addAtRight);
          assert.deepEqual(
            toolbar.others,
            [localize(language).t('addPanel')],
            'no project name, directory or panel count',
          );
          assert.equal(toolbar.entries.length, 4);
          for (const entry of toolbar.entries) {
            assert.ok(entry.inside, `${entry.label} at ${width}px`);
            assert.equal(entry.hint, entry.label);
          }
          const toolbarLeft = () =>
            evaluate('document.querySelector(".workspace-toolbar").getBoundingClientRect().left');
          const left = await toolbarLeft();
          await click(localize(language).t(navigation));
          await until(
            async () => (await toolbarLeft()) !== left,
            `toolbar moved with the ${navigation === 'collapseNavigation' ? 'collapsed' : 'expanded'} navigation`,
          );
        }
      }
    }
    window.setContentSize(1280, 860);
    await evaluate('window.workbench.saveSettings({ language: "en" })');
    await until(() => evaluate('document.documentElement.lang === "en"'), 'interface switched to en');
    await evaluate(
      `document.querySelector(${named(`[data-panel-id="${second.panelId}"] button`, t('enlargePanel'))}).click()`,
    );
    await writeFile(`${directory}/summary-expected.json`, JSON.stringify(await f.snapshot()));
    console.log(
      'Summary lists preserve real input recipients, source viewing mode, records and runs; projection, keyboard, constrained geometry and the four-entry narrow collapse passed.',
    );
  },
  async reopen({ evaluate, until, directory }) {
    const saved = JSON.parse(await readFile(`${directory}/summary-expected.json`, 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(
      async () => runsOf(await evaluate('window.workbench.fetchSnapshot()')).length === active.panels.length,
      'reopened project has a run for every panel',
    );
    const current = await evaluate('window.workbench.fetchSnapshot()');
    assert.deepEqual(storedProjects(current), storedProjects(saved));
    assert.ok(runsOf(current).every(run => !runsOf(saved).some(old => old.id === run.id)));
    await until(
      async () => (await visiblePanels(evaluate)) === active.panels.length,
      'reopened layout shows every panel',
    );
    assert.equal(await evaluate(`document.querySelectorAll(${named('.canvas button', t('restorePanel'))}).length`), 0);

    console.log('Reopening retained the saved layout, with fresh runs and no persisted temporary maximize.');
  },
};
