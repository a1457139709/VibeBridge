const assert = require('node:assert/strict');
const { build } = require('esbuild');

module.exports = {
  async run({ window, evaluate, until }) {
    await until(() => evaluate('!!document.querySelector(".setup")'));
    const initial = { ...await evaluate('window.workbench.snapshot()'), activeProjectId: 'project',
      projects: [{ id: 'project', name: 'Navigation project', directory: '/', panels: [{ id: 'panel', agent: 'codex' }], layout: { panel: 'panel' } }],
      runs: [{ id: 'run', projectId: 'project', panelId: 'panel', state: 'running', rawTitle: 'Original title | /project' }] };
    const bundle = await build({ entryPoints: ['tests/fixtures/project-navigation.tsx'], bundle: true, write: false,
      format: 'iife', globalName: 'ProjectNavigationFixture', platform: 'browser', loader: { '.css': 'empty' } });
    await evaluate(bundle.outputFiles[0].text);
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const act = async code => { await evaluate(code); await settle(); };
    const click = label => act(`window.fixture.host.querySelector('button[aria-label="${label}"]').click()`);
    const width = () => evaluate('window.fixture.host.querySelector("nav").getBoundingClientRect().width');
    const fresh = () => act(`window.fixture?.dispose(); window.fixture = ProjectNavigationFixture.createFixture(${JSON.stringify(initial)}); void 0`);
    const originalSize = window.getSize();
    const resizeEdge = () => evaluate(`(() => { const b = window.fixture.host.querySelector('[role="separator"]').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
    const drag = async delta => {
      window.focus(); window.webContents.focus();
      const edge = await resizeEdge();
      window.webContents.sendInputEvent({ type: 'mouseDown', ...edge, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseMove', x: edge.x + delta, y: edge.y, modifiers: ['leftButtonDown'] });
      await settle();
      window.webContents.sendInputEvent({ type: 'mouseUp', x: edge.x + delta, y: edge.y, button: 'left', clickCount: 1 });
      await settle();
    };
    const confirm = index => act(`window.fixture.snapshot({ navigation: window.fixture.requests[${index}].preferences }); window.fixture.requests[${index}].resolve()`);
    try {
      await fresh();
      await drag(100);
      assert.equal(await width(), 312);
      await click('折叠项目导航');
      await confirm(0);
      assert.equal(await width(), 0, 'an old snapshot cannot replace the latest collapse preview');
      await confirm(1);
      assert.equal(await width(), 0);
      await click('展开项目导航'); await confirm(2);
      assert.equal(await width(), 212, 'collapse supersedes the unconfirmed width instead of merging it');
      await drag(100); await confirm(3);
      await click('折叠项目导航'); await confirm(4);
      await click('展开项目导航'); await confirm(5);
      assert.equal(await width(), 312, 'a confirmed resize is retained by a later collapse');

      await fresh();
      await drag(100);
      await drag(40);
      assert.equal(await width(), 352);
      await confirm(0);
      assert.equal(await width(), 352, 'an old snapshot and acknowledgement cannot clear a newer drag preview');
      await act(`window.fixture.snapshot({ navigation: { visible: true, width: 312 },
        projects: ${JSON.stringify(initial.projects.map(project => ({ ...project, name: 'Renamed project' })))},
        runs: ${JSON.stringify(initial.runs.map(run => ({ ...run, rawTitle: 'Newest title | /project' })))} })`);
      assert.equal(await width(), 352);
      assert.match(await evaluate('window.fixture.host.textContent'), /Renamed project.*Newest title/);
      await confirm(1);
      assert.equal(await width(), 352);
      console.log('PASS: navigation replaces unconfirmed preferences and preserves the newest resize preview.');

      await fresh();
      await drag(100);
      await click('折叠项目导航');
      await confirm(0);
      await act('window.fixture.requests[1].reject(new Error("导航保存失败"))');
      assert.equal(await width(), 312, 'failure restores the latest known saved state, including a superseded write');
      assert.deepEqual(await evaluate('window.fixture.notices'), ['导航保存失败']);
      await click('折叠项目导航'); await confirm(2);
      await click('展开项目导航'); await confirm(3);
      assert.equal(await width(), 312, 'navigation remains usable after a failed save');
      console.log('PASS: the latest save failure reports once, restores known preferences and allows retry.');

      await fresh();
      window.setSize(300, 580);
      await until(() => evaluate('innerWidth === 300'));
      assert.equal(await width(), 140, 'small windows may temporarily constrain the visible navigation');
      const edge = await resizeEdge();
      window.webContents.sendInputEvent({ type: 'mouseDown', ...edge, button: 'left', clickCount: 1 });
      window.webContents.sendInputEvent({ type: 'mouseUp', ...edge, button: 'left', clickCount: 1 });
      await settle();
      await act('window.fixture.snapshot({ navigation: { visible: true, width: 168 } }); window.fixture.requests[0].resolve()');
      window.setSize(...originalSize); await settle();
      assert.equal(await width(), 168, 'release without moving still respects the persisted width minimum');
      console.log('PASS: a stationary resize in a constrained window keeps the saved width within bounds.');
    } finally {
      window.setSize(...originalSize);
      await evaluate('window.fixture?.dispose(); window.fixture = undefined');
    }
  },
};
