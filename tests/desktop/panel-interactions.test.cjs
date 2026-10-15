const assert = require('node:assert/strict');
const { build } = require('esbuild');

module.exports = {
  async run({ window, evaluate }) {
    const bundle = await build({ entryPoints: ['tests/fixtures/panel-interactions.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'PanelInteractionFixture', platform: 'browser' });
    await evaluate(bundle.outputFiles[0].text);
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const fresh = async () => { await evaluate('window.fixture?.dispose(); window.fixture = PanelInteractionFixture.createFixture(); void 0'); await settle(); };
    const point = selector => evaluate(`(() => { const r = window.fixture.canvas.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
    const mouse = (type, p) => window.webContents.sendInputEvent({ type, ...p,
      ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : { button: 'left', clickCount: 1 }) });
    const begin = async selector => {
      // Avoid the intersection of the outer and nested dividers.
      const p = await evaluate(`(() => { const r = window.fixture.canvas.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 4), y: Math.round(r.y + r.height / 4) }; })()`);
      mouse('mouseDown', p); await settle(); return p;
    };
    try {
      await fresh();
      await begin('[data-panel-id="a"] .panel-header');
      const b = await point('[data-panel-id="b"] .agent-panel');
      const c = await point('[data-panel-id="c"] .agent-panel');
      mouse('mouseMove', b); await settle();
      mouse('mouseMove', c); await settle();
      assert.deepEqual(await evaluate('window.fixture.commits'), [], 'Hover never saves a layout');
      mouse('mouseUp', b); await settle();
      assert.deepEqual(await evaluate('window.fixture.commits'), [{ axis: 'row', ratio: .3, first: { panel: 'b' },
        second: { axis: 'column', ratio: .5, first: { panel: 'a' }, second: { panel: 'c' } } }], 'Release coordinates exchange only the original source and final target, once');
      assert.equal(await evaluate('!!document.querySelector(".panel-drag-image, .panel-swap-preview")'), false);
      console.log('PASS: public interface exchanges from the initial layout and commits only the final release target.');
      await fresh();
      await evaluate('window.fixture.update({ layout: { ...window.fixture.presented, ratio: .27 } })'); await settle();
      const terminalBox = () => evaluate(`(() => { const r = window.fixture.canvas.querySelector('[data-panel-id="a"] .terminal-container').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      const tiny = () => evaluate(`window.fixture.canvas.querySelector('[data-panel-id="a"] .agent-panel').dataset.tiny`);
      assert.equal(await tiny(), 'false');
      await evaluate('window.fixture.title("a", "WWWWWWWWWWWW latest title")'); await settle();
      assert.equal(await tiny(), 'true', 'A title changed before preview is measured immediately');
      await evaluate('window.fixture.title("a", "Alpha")'); await settle();
      const beforeTitle = await terminalBox();
      await begin('[data-panel-id="a"] .panel-header');
      mouse('mouseMove', await point('[data-panel-id="b"] .agent-panel')); await settle();
      for (const title of ['WWWWWWWWWWWW first title', 'Alpha', 'WWWWWWWWWWWW latest title']) {
        await evaluate(`window.fixture.title('a', ${JSON.stringify(title)})`); await settle();
        assert.deepEqual(await terminalBox(), beforeTitle, 'Live titles and fresh snapshots leave held-preview geometry unchanged');
      }
      await evaluate('window.fixture.interactions.cancel()'); await settle();
      mouse('mouseUp', b); await settle();
      assert.equal(await tiny(), 'true', 'Cancellation measures the latest title');
      assert.deepEqual(await evaluate('window.fixture.commits'), []);
      console.log('PASS: title updates measure before preview, freeze during preview and resume with the latest title on cancellation.');
      await fresh();
      const divider = await begin('[data-divider=""]');
      mouse('mouseMove', { x: 25, y: divider.y }); await settle();
      assert.ok(await evaluate('window.fixture.presented.ratio < .3'), 'Divider layout changes before release');
      assert.equal(await tiny(), 'true', 'Compact presentation changes while the divider is still held');
      assert.deepEqual(await evaluate('window.fixture.commits'), [], 'Live resize is not saved before release');
      await evaluate('window.fixture.interactions.cancel()'); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .3, 'Cancellation restores the saved layout');
      assert.equal(await tiny(), 'false');
      mouse('mouseUp', divider); await settle();
      assert.deepEqual(await evaluate('window.fixture.commits'), [], 'A late pointerup cannot save a cancelled resize');
      console.log('PASS: divider geometry and compact presentation update before release; cancellation restores the saved layout.');
      const cancellations = [
        ['explicit cancel', 'window.fixture.interactions.cancel(); window.fixture.interactions.cancel()'],
        ['Escape', 'window.fixture.canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'],
        ['blur', 'window.dispatchEvent(new Event("blur"))'],
        ['window resize', 'window.dispatchEvent(new Event("resize"))'],
        ['canvas resize', 'window.fixture.canvas.style.width = "700px"'],
        ['canvas translation', 'window.fixture.canvas.style.left = "40px"'],
        ['hidden context', 'window.fixture.update({ visible: false })'],
        ['hidden DOM', 'window.fixture.canvas.style.display = "none"'],
        ['project switch', 'window.fixture.update({ projectId: "other-project" })'],
        ['external layout', 'window.fixture.update({ layout: { ...window.fixture.presented, ratio: .45 } })', .45],
        ['maximize', 'window.fixture.update({ maximizedPanelId: "a" })'],
        ['pointer cancellation', 'window.pointerHandle.dispatchEvent(new PointerEvent("pointercancel", { pointerId: window.pointerId }))'],
        ['capture lost', 'window.pointerHandle.releasePointerCapture(window.pointerId)'],
        ['dispose', 'window.fixture.interactions.dispose(); window.fixture.interactions.dispose()'],
      ];
      for (const kind of ['swap', 'resize']) {
        for (const [reason, cancel, expectedRatio = .3] of cancellations) {
          await fresh();
          await evaluate(`window.fixture.canvas.addEventListener('pointerdown', event => { window.pointerId = event.pointerId; window.pointerHandle = event.target.closest('.panel-header, .divider'); }, { once: true, capture: true })`);
          const handle = kind === 'swap' ? '[data-panel-id="a"] .panel-header' : '[data-divider=""]';
          const start = await begin(handle);
          const end = kind === 'swap' ? await point('[data-panel-id="b"] .agent-panel') : { x: start.x + 80, y: start.y };
          mouse('mouseMove', end); await settle();
          assert.equal(await evaluate(kind === 'swap' ? '!!document.querySelector(".panel-swap-preview")' : 'window.fixture.presented.ratio !== .3'), true, `${kind} starts before ${reason}`);
          await evaluate(cancel); await settle();
          mouse('mouseUp', end); await settle();
          assert.deepEqual(await evaluate('window.fixture.commits'), [], `${reason} cancels ${kind} and ignores late pointerup`);
          assert.equal(await evaluate('window.fixture.presented.ratio'), expectedRatio, `${reason} restores the latest valid layout`);
          assert.equal(await evaluate('!!document.querySelector(".panel-drag-image, .panel-swap-preview, .panel-drag-hidden")'), false, `${reason} releases preview images`);
        }
      }
      console.log(`PASS: ${cancellations.length} cancellation paths for each interaction, including late events, latest layout and repeated disposal.`);
      await fresh();
      await evaluate('window.fixture.interactions.dispose(); window.fixture.title("a", "WWWWWWWWWWWW title after disposal"); window.fixture.canvas.style.width = "150px"'); await settle();
      assert.equal(await tiny(), 'false', 'Disposal stops observation and subsequent context updates');
      for (const disabled of [{ visible: false }, { maximizedPanelId: 'a' }]) {
        await fresh(); await evaluate(`window.fixture.update(${JSON.stringify(disabled)})`);
        for (const handle of ['[data-panel-id="a"] .panel-header', '[data-divider=""]']) {
          await begin(handle); mouse('mouseMove', { x: 600, y: 170 }); mouse('mouseUp', { x: 600, y: 170 }); await settle();
          assert.deepEqual(await evaluate('window.fixture.commits'), []);
          assert.equal(await evaluate('window.fixture.presented.ratio'), .3, 'Hidden or maximized views cannot start layout operations');
        }
      }
      console.log('PASS: disposed observers stop updating; hidden/maximized contexts reject both operations.');
      await fresh();
      await evaluate('window.fixture.update({ layout: { ...window.fixture.presented, ratio: .05 } })'); await settle();
      const undersized = await begin('[data-divider=""]');
      mouse('mouseMove', { x: undersized.x - 20, y: undersized.y }); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .05, 'An undersized panel cannot shrink');
      mouse('mouseMove', { x: undersized.x + 10, y: undersized.y }); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .0625);
      mouse('mouseMove', { x: undersized.x - 20, y: undersized.y }); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .0625, 'Reversing before the minimum cannot surrender recovered space');
      mouse('mouseMove', { x: undersized.x + 120, y: undersized.y }); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .2);
      mouse('mouseMove', { x: undersized.x + 100, y: undersized.y }); await settle();
      assert.equal(await evaluate('window.fixture.presented.ratio'), .175, 'After reaching the minimum, ordinary bidirectional resizing resumes');
      await evaluate('window.latestCommits = []; window.fixture.update({ commitLayout: layout => window.latestCommits.push(layout) })');
      mouse('mouseUp', { x: undersized.x + 100, y: undersized.y }); await settle();
      assert.deepEqual(await evaluate('window.fixture.commits'), [], 'Commit uses the latest application callback');
      assert.equal(await evaluate('window.latestCommits.length'), 1);
      assert.equal(await evaluate('window.latestCommits[0].ratio'), .175);
      console.log('PASS: undersized growth/reversal rules and fresh commit callbacks.');
      await fresh();
      await evaluate('window.fixture.canvas.addEventListener("pointerdown", event => { window.pointerId = event.pointerId }, { once: true })');
      await begin('[data-panel-id="a"] .panel-header');
      mouse('mouseMove', b); await settle();
      await evaluate(`(() => { const handle = window.fixture.canvas.querySelector('[data-divider=""]'); const r = handle.getBoundingClientRect(); handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: window.pointerId, button: 0, clientX: r.x + 2, clientY: r.y + 30 })); })()`);
      await settle();
      assert.equal(await evaluate('!!document.querySelector(".panel-swap-preview")'), true, 'A second operation cannot replace an active interaction');
      mouse('mouseUp', b); await settle();
      assert.equal(await evaluate('window.fixture.commits.length'), 1);
      assert.equal(await evaluate('window.fixture.commits[0].first.panel'), 'b');
      console.log('PASS: active operations are mutually exclusive.');
    } finally { await evaluate('window.fixture?.dispose()'); }
  },
};
