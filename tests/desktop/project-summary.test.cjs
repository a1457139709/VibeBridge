const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');

const visiblePanels = evaluate => evaluate('[...document.querySelectorAll(".canvas [data-panel-id]")].filter(panel => panel.checkVisibility({ visibilityProperty: true })).length');

module.exports = {
  async run(context) {
    const { evaluate, until, click, window, directory } = context;
    assert.equal(await evaluate('document.querySelector(".project-summary").textContent'), '');
    const f = await require('./support/summary.cjs')(context);
    const [first, second, third] = f.runs;
    const initial = await f.snapshot();
    const project = initial.projects.find(project => project.id === f.projectId);
    const layout = { axis: 'row', ratio: .3, first: { panel: first.panelId },
      second: { axis: 'column', ratio: .4, first: { panel: second.panelId }, second: { panel: third.panelId } } };
    await evaluate(`window.workbench.saveLayout(${JSON.stringify(f.projectId)}, ${JSON.stringify(layout)})`);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".summary-entry")].map(button => button.textContent)'), ['1 Needs input', '2 Done', '0 Error']);
    await f.choose('done', second); await f.receiveInput(second, 'split-selection');
    assert.equal(await visiblePanels(evaluate), 3);
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] button[aria-label="放大面板"]').click()`);
    await f.choose('done', second); await f.receiveInput(second, 'maximized-selection');
    assert.equal(await visiblePanels(evaluate), 1);
    await click('全局设置');
    await f.choose('done', first); await f.receiveInput(first, 'settings-maximized-selection');
    assert.equal(await visiblePanels(evaluate), 1);
    await click('还原面板');
    await click('全局设置');
    await f.choose('done', second); await f.receiveInput(second, 'settings-split-selection');
    assert.equal(await visiblePanels(evaluate), 3);

    // A newer list selection supersedes a target that is visible but cannot yet
    // receive terminal input. Hiding only the terminal models delayed layout.
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = 'none'`);
    await f.choose('done', first);
    await until(() => evaluate('document.querySelector(".workbench-page").classList.contains("locating-panel")'));
    await f.choose('done', second); await f.receiveInput(second, 'newer-selection');
    await evaluate(`document.querySelector('[data-panel-id="${first.panelId}"] .terminal-container').style.display = ''`);
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    assert.ok(await f.focused(second));
    assert.ok(await evaluate(`document.querySelector('[data-panel-id="${second.panelId}"] .xterm-rows').textContent.includes('RECEIVED:split-selection')`));
    const unchanged = await f.snapshot();
    assert.deepEqual(unchanged.runs.map(run => [run.id, run.pid]), initial.runs.map(run => [run.id, run.pid]));
    assert.deepEqual(unchanged.projects[0].layout, layout);

    // Background projects keep updating navigation while the summary follows
    // project navigation. A project-title visit retains its saved viewing mode.
    const otherDirectory = `${directory}/other`; await mkdir(otherDirectory);
    await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Other summary project', directory: otherDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`);
    await click('Other summary project');
    await f.send(third, { payload: { hook_event_name: 'Stop' } });
    await until(() => evaluate(`document.querySelector('[data-locate-panel-id="${third.panelId}"] .processing-status')?.getAttribute('aria-label') === 'Done'`));
    assert.equal(await evaluate('document.querySelectorAll(".project-summary").length'), 1);
    assert.ok(await evaluate('[...document.querySelectorAll(".summary-entry")].some(button => button.textContent === "0 Done")'));
    await click(project.name);
    await until(() => evaluate('[...document.querySelectorAll(".summary-entry")].some(button => button.textContent === "3 Done")'));

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
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      for (const size of [[1280, 860], [640, 480]]) {
        window.setContentSize(...size);
        await until(() => evaluate(`document.documentElement.clientWidth === ${size[0]}`));
        for (const collapsed of [false, true]) {
          if (collapsed) await click('折叠项目导航');
          await f.open('done');
          const geometry = await evaluate(`(() => {
            const bar = document.querySelector('.project-summary').getBoundingClientRect();
            const list = document.querySelector('.summary-list').getBoundingClientRect();
            const trigger = document.querySelector('.summary-entry[aria-expanded=true]').getBoundingClientRect();
            const scroll = document.querySelector('.summary-list ul');
            return { barHeight: bar.height, bottom: bar.bottom, windowHeight: innerHeight,
              contained: list.left >= 0 && list.top >= 0 && list.right <= innerWidth && list.bottom < bar.top,
              adjacent: Math.abs(list.left - trigger.left) < 1 && bar.top - list.bottom < 6,
              scrolling: scroll.scrollHeight > scroll.clientHeight,
              entriesVisible: [...document.querySelectorAll('.summary-entry')].every(entry => {
                const box = entry.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.top >= bar.top && box.bottom <= bar.bottom;
              }) };
          })()`);
          assert.equal(geometry.barHeight, 36); assert.equal(geometry.bottom, geometry.windowHeight);
          assert.ok(geometry.contained); assert.ok(geometry.adjacent); assert.ok(geometry.scrolling); assert.ok(geometry.entriesVisible);
          f.nativeKey('Escape');
          await until(() => evaluate('!document.querySelector(".summary-list")'));
          assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), '10 Done');
          if (collapsed) await click('展开项目导航');
        }
      }
    }
    // Persisted configuration is tested in a second Electron process; temporary
    // maximize must not overwrite the layout, and old runs must not be resumed.
    await evaluate(`document.querySelector('[data-panel-id="${second.panelId}"] button[aria-label="放大面板"]').click()`);
    await writeFile(`${directory}/summary-expected.json`, JSON.stringify(await f.snapshot()));
    console.log('Summary lists preserve real input recipients, source viewing mode, records and runs; projection, keyboard and constrained geometry passed.');
  },
  async reopen({ evaluate, until, directory }) {
    const saved = JSON.parse(await readFile(`${directory}/summary-expected.json`, 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(async () => (await evaluate('window.workbench.snapshot()')).runs.length === active.panels.length);
    const current = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(current.projects, saved.projects);
    assert.ok(current.runs.every(run => !saved.runs.some(old => old.id === run.id)));
    await until(async () => await visiblePanels(evaluate) === active.panels.length);
    assert.equal(await evaluate('document.querySelectorAll(".canvas button[aria-label=还原面板]").length'), 0);
    console.log('Reopening retained the saved layout, with fresh runs and no persisted temporary maximize.');
  },
};
