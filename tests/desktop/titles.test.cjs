const assert = require('node:assert/strict');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

async function verifyTitles(context) {
  const { window, evaluate, click, fill, until, directory, reopen } = context;
  if (reopen) {
    const saved = JSON.parse(await readFile(join(directory, 'titles-expected.json'), 'utf8'));
    const active = saved.projects.find(project => project.id === saved.activeProjectId);
    await until(() => evaluate(`document.querySelectorAll('.canvas .xterm').length === ${active.panels.length}`));
    const snapshot = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(snapshot.projects, saved.projects);
    assert.ok(snapshot.runs.every(run => !saved.runs.some(old => old.id === run.id) && run.rawTitle === undefined));
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), active.panels.map(panel => panel.id));
    assert.equal(await evaluate(`document.querySelectorAll('.session-title').length === [...document.querySelectorAll('.session-title')].filter(title => title.textContent === 'Untitled task').length`), true);
    assert.equal(await evaluate(`!!document.querySelector('button[aria-label="还原面板"]')`), false);
    for (const project of saved.projects.filter(project => project.id !== active.id)) {
      await click(`展开项目面板：${project.name}`);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-project-id="${project.id}"] [data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), project.panels.map(panel => panel.id));
    }
    await require('./scenarios/titles-reopen.cjs')({ window, evaluate, until, snapshot, target: saved.projects.find(project => project.name === 'Dormant startup target') });
    console.log('PASS: real quit/reopen preserves creation order and committed layouts, resets expansion/maximize/raw titles, and starts new runs');
    return;
  }
  await until(() => evaluate(`!!document.querySelector('.setup')`));
  await evaluate(`window.titleOutput = []; window.workbench.subscribe(event => { if (event.kind === 'output') window.titleOutput.push(event); }); void 0;`);
  const create = (name, path, total, counts = { codex: total, claude: 0, pi: 0 }) => evaluate(`window.workbench.createProject(${JSON.stringify({ name, directory: path, total, counts })})`);
  const first = (await create('First title project', directory, 3, { codex: 1, claude: 1, pi: 1 })).project;
  await click(first.name);
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 3`));
  const before = await evaluate('window.workbench.snapshot()');
  const firstRun = before.runs.find(run => run.panelId === first.panels[0].id);
  await until(() => evaluate(`window.titleOutput.some(event => event.runId === ${JSON.stringify(firstRun.id)} && event.data.includes('READY:'))`));
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-locate-panel-id]')].map(button => button.dataset.locatePanelId)`), first.panels.map(panel => panel.id));
  assert.equal(await evaluate(`document.querySelector('[data-panel-id="${first.panels[0].id}"] .session-title').textContent`), 'Untitled task');
  await require('./scenarios/title-filtering.cjs')({ window, evaluate, until, project: first, runs: before.runs });
  const raw = 'Exact session title | directory';
  const displayed = 'Exact session title';
  await evaluate(`window.workbench.sendInput(${JSON.stringify(firstRun.id)}, ${JSON.stringify(JSON.stringify({ id: 'desktop-title', chunks: ['\x1b]2;' + raw + '\x07'] }) + '\n')})`);
  await until(() => evaluate(`document.querySelector('[data-panel-id="${first.panels[0].id}"] .session-title').textContent === ${JSON.stringify(displayed)}`));
  assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"] .session-title').textContent`), displayed);
  assert.equal(await evaluate(`document.querySelectorAll('[aria-label="更多面板操作"]').length`), 0);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.session-title')).whiteSpace`), 'pre');
  assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').title`), displayed);
  // Clicking the already selected item must take focus back from navigation and deliver input once.
  window.focus(); window.webContents.focus();
  await evaluate(`document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').focus(); document.querySelector('[data-locate-panel-id="${first.panels[0].id}"]').click()`);
  await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(first.panels[0].id)}`));
  window.webContents.sendInputEvent({ type: 'char', keyCode: 'q' });
  await until(() => evaluate(`window.titleOutput.some(event => event.data.includes('INPUT:q'))`));
  assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes('INPUT:q')).map(event => event.runId))]`), [firstRun.id]);
  console.log('PASS: shared filtered title, creation-ordered navigation, removed More menu and same-selected native refocus');
  if (process.env.VIBEBRIDGE_TEST_SCREENSHOT) await writeFile(process.env.VIBEBRIDGE_TEST_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  const secondDirectory = join(directory, 'second'); await mkdir(secondDirectory);
  const second = (await create('Second title project', secondDirectory, 2)).project;
  await click(second.name);
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 2`));
  const projectSnapshots = (await evaluate('window.workbench.snapshot()')).projects;
  const runs = (await evaluate('window.workbench.snapshot()')).runs;
  const locate = async (panelId, character) => {
    await evaluate(`document.querySelector('[data-locate-panel-id="${panelId}"]').focus(); document.querySelector('[data-locate-panel-id="${panelId}"]').click()`);
    await until(() => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(panelId)}`));
    if (character) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
      await until(() => evaluate(`window.titleOutput.some(event => event.data.includes(${JSON.stringify('INPUT:' + character)}))`));
      assert.deepEqual(await evaluate(`[...new Set(window.titleOutput.filter(event => event.data.includes(${JSON.stringify('INPUT:' + character)})).map(event => event.runId))]`), [runs.find(run => run.panelId === panelId).id]);
    }
    await until(() => evaluate(`!document.querySelector('.locating-panel')`));
  };
  const restored = panelId => evaluate(`!!document.querySelector('[data-panel-id="${panelId}"] button[aria-label="还原面板"]')`);
  const maximize = panelId => evaluate(`document.querySelector('[data-panel-id="${panelId}"] button[aria-label="放大面板"]').click()`);
  const fixture = { first, second, firstRun, runs, projectSnapshots };
  const navigation = { locate, restored, maximize };
  await require('./scenarios/title-navigation.cjs')(context, fixture, navigation);
  await require('./scenarios/title-presentation.cjs')(context, fixture, navigation);
  await require('./scenarios/title-settings.cjs')({ window, evaluate, click, fill, until, directory, first, second, locate });
  for (const panel of second.panels) await evaluate(`window.workbench.closePanel(${JSON.stringify(second.id)}, ${JSON.stringify(panel.id)})`);
  await until(() => evaluate(`document.querySelectorAll('[data-project-id="${second.id}"] [data-locate-panel-id]').length === 0`));
  assert.equal(await evaluate(`document.querySelector('[data-project-id="${second.id}"] .project-link small').textContent`), '0');
  console.log('PASS: independent expansion, per-project maximize memory, long-title ellipsis with permanent actions, native swap/resize order and add/close/zero entries');
  const dormantDirectory = join(directory, 'dormant'); await mkdir(dormantDirectory);
  await create('Dormant startup target', dormantDirectory, 1);
  await click(first.name);
  await until(async () => (await evaluate('window.workbench.snapshot()')).activeProjectId === first.id);
  await writeFile(join(directory, 'titles-expected.json'), JSON.stringify(await evaluate('window.workbench.snapshot()')));
}

module.exports = {
  configure: settings => ({ ...settings, agents: Object.fromEntries(Object.keys(settings.agents)
    .map(agent => [agent, { command: 'node', args: [resolve('tests/fixtures/title-cli.cjs')] }])) }),
  run: verifyTitles,
  reopen: verifyTitles,
};
