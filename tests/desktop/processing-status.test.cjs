const assert = require('node:assert/strict');
const { resolve } = require('node:path');

module.exports = {
  async run(context) {
    const { window, evaluate, until, click } = context;
    const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/status-cli.cjs')] };
    await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { codex: command, claude: command, pi: command } })})`);
    const created = await require('./support/project.cjs')(context, 'Status panels');
    const projectId = created.activeProjectId;
    for (let index = 0; index < 4; index++) await evaluate(`window.workbench.addPanel(${JSON.stringify(projectId)}, 'codex')`);
    const runs = (await evaluate('window.workbench.snapshot()')).runs;
    const cases = [
      ['ready', 'Ready', { hook_event_name: 'SessionStart', source: 'startup' }],
      ['busy', 'Busy', { hook_event_name: 'UserPromptSubmit' }],
      ['needs-input', 'Needs input', { hook_event_name: 'PermissionRequest' }],
      ['done', 'Done', { hook_event_name: 'Stop' }],
      ['error', 'Error', { hook_event_name: 'unclassified' }],
    ];
    for (const [index, [state, label, payload]] of cases.entries()) {
      const message = { id: state, payload, output: `\x1b]2;${label} with a long session title for compact panels | project\x07` };
      await evaluate(`window.workbench.sendInput(${JSON.stringify(runs[index].id)}, ${JSON.stringify(JSON.stringify(message) + '\n')})`);
      await until(() => evaluate(`document.querySelector('[data-panel-id="${runs[index].panelId}"] .processing-status')?.getAttribute('aria-label') === ${JSON.stringify(label)}`));
      assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${runs[index].panelId}"] .processing-status').getAttribute('aria-label')`), label);
    }
    // Real keyboard focus must expose the same label, without clearing Done.
    await evaluate(`document.querySelector('[data-panel-id="${runs[3].panelId}"] .processing-status').focus()`);
    assert.equal(await evaluate('document.activeElement.getAttribute("aria-label")'), 'Done');
    assert.equal((await evaluate('window.workbench.snapshot()')).processing.runs[runs[3].id], 'done');

    const checkGeometry = async () => {
      const result = await evaluate(`(() => {
        const panels = [...document.querySelectorAll('.canvas .agent-panel')].filter(panel => panel.checkVisibility());
        return panels.map(panel => {
          const icon = panel.querySelector('.processing-status'), mark = panel.querySelector('.agent-mark');
          const a = icon.getBoundingClientRect(), b = mark.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
          const style = getComputedStyle(icon.querySelector('svg'));
          return { leftOfType: a.right <= b.left, visible: a.width >= 13 && a.height >= 13
            && a.left >= bounds.left && a.right <= bounds.right && a.top >= bounds.top && a.bottom <= bounds.bottom,
            static: style.animationName === 'none', busy: icon.classList.contains('processing-busy'), label: icon.getAttribute('aria-label') };
        });
      })()`);
      assert.ok(result.length);
      for (const icon of result) {
        assert.ok(icon.leftOfType); assert.ok(icon.visible); assert.ok(icon.label);
        assert.equal(icon.static, !icon.busy || reducedMotion, `${icon.label} moves only while Busy and motion is allowed`);
      }
      // Every rendered Busy icon, in panels and navigation, turns in one shared phase.
      const phases = await evaluate(`[...document.querySelectorAll('.processing-busy svg')].flatMap(icon => icon.getAnimations())
        .map(animation => animation.currentTime % ${busyPeriod})`);
      if (!reducedMotion) {
        assert.ok(phases.length >= 1);
        for (const phase of phases) assert.ok(Math.min(Math.abs(phase - phases[0]), busyPeriod - Math.abs(phase - phases[0])) < 50, `Busy phases ${phases}`);
      } else assert.deepEqual(phases, []);
    };
    let reducedMotion = false;
    const busyPeriod = 1500; // processing-spin duration in processing-status.css
    for (const language of ['en', 'zh-CN']) {
      await evaluate(`window.workbench.saveSettings({ language: ${JSON.stringify(language)} })`);
      await until(() => evaluate(`document.documentElement.lang === ${JSON.stringify(language)}`));
      const labels = language === 'en' ? ['Ready', 'Busy', 'Needs input', 'Done', 'Error'] : ['就绪', '处理中', '等待输入', '本轮结束', '异常'];
      for (const [index, label] of labels.entries()) {
        assert.equal(await evaluate(`document.querySelector('[data-panel-id="${runs[index].panelId}"] .processing-status').getAttribute('aria-label')`), label);
        assert.equal(await evaluate(`document.querySelector('[data-locate-panel-id="${runs[index].panelId}"] .processing-status').getAttribute('aria-label')`), label);
      }
      for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        for (const size of [[1280, 860], [640, 480]]) {
          window.setContentSize(...size);
          await until(() => evaluate(`document.documentElement.clientWidth === ${size[0]}`));
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await checkGeometry();
        }
      }
      // Drag actual split handles to a compact row, then the enforced width/height
      // minima. The status/type pair stays horizontal in all three presentations.
      window.setContentSize(1280, 860);
      await until(() => evaluate('document.documentElement.clientWidth === 1280'));
      for (const [axis, size, presentation] of [['row', 180, 'row'], ['row', 1, 'stacked'], ['column', 1, 'strip']]) {
        const remaining = runs.slice(1).map(run => run.panelId);
        const rest = ids => ids.length === 1 ? { panel: ids[0] }
          : { axis, ratio: 1 / ids.length, first: { panel: ids[0] }, second: rest(ids.slice(1)) };
        const layout = { axis, ratio: .5, first: { panel: runs[0].panelId }, second: rest(remaining) };
        await evaluate(`window.workbench.saveLayout(${JSON.stringify(projectId)}, ${JSON.stringify(layout)})`);
        await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        const handle = await evaluate(`(() => { const rect = document.querySelector('.divider').getBoundingClientRect();
          const canvas = document.querySelector('.canvas').getBoundingClientRect();
          return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), left: canvas.left, top: canvas.top }; })()`);
        // Electron's button identifies the changed button; modifiers carry the
        // held buttons across movement so Chromium retains pointer capture.
        window.webContents.sendInputEvent({ type: 'mouseDown', x: handle.x, y: handle.y, button: 'left', modifiers: ['leftbuttondown'], clickCount: 1 });
        // Native input dispatch is asynchronous. Observe capture and preview before
        // releasing, then require a persisted resize before starting another drag.
        await until(() => evaluate('document.querySelector(".canvas").classList.contains("resizing")'));
        const destination = { x: axis === 'row' ? Math.round(handle.left + size) : handle.x,
          y: axis === 'column' ? Math.round(handle.top + size) : handle.y };
        window.webContents.sendInputEvent({ type: 'mouseMove', ...destination, button: 'left', modifiers: ['leftbuttondown'] });
        await until(() => evaluate(`(() => {
          const panel = document.querySelector('[data-panel-id="${runs[0].panelId}"]').getBoundingClientRect();
          const canvas = document.querySelector('.canvas').getBoundingClientRect();
          return ${axis === 'row' ? 'panel.width < canvas.width * .49' : 'panel.height < canvas.height * .49'};
        })()`));
        window.webContents.sendInputEvent({ type: 'mouseUp', ...destination, button: 'left', clickCount: 1 });
        await until(() => evaluate('!document.querySelector(".canvas").classList.contains("resizing")'));
        await until(async () => (await evaluate('window.workbench.snapshot()')).projects.find(project => project.id === projectId).layout.ratio < .49);
        await until(() => evaluate(`document.querySelector('[data-panel-id="${runs[0].panelId}"] .agent-panel').dataset.compactLayout === '${presentation}'`));
        await checkGeometry();
      }
      await click(language === 'en' ? 'Collapse project navigation' : '折叠项目导航'); await checkGeometry(); await click(language === 'en' ? 'Expand project navigation' : '展开项目导航');
    }
    await evaluate('window.workbench.saveSettings({ language: "en" })');
    await until(() => evaluate('document.documentElement.lang === "en"'));
    window.webContents.debugger.attach();
    try {
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      reducedMotion = true;
      await checkGeometry();
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      reducedMotion = false;
    } finally { window.webContents.debugger.detach(); }
    await evaluate(`document.querySelector('[data-panel-id="${runs[3].panelId}"] button[aria-label="Maximize panel"]').click()`);
    await checkGeometry();
    await until(() => evaluate(`document.activeElement.closest('[data-panel-id]')?.dataset.panelId === '${runs[3].panelId}' && document.activeElement.classList.contains('xterm-helper-textarea')`));
    const input = JSON.stringify({ id: 'native-input', payload: { hook_event_name: 'UserPromptSubmit' } });
    for (const character of input) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await until(async () => (await evaluate('window.workbench.snapshot()')).processing.runs[runs[3].id] === 'busy');
    assert.equal((await evaluate('window.workbench.snapshot()')).processing.runs[runs[4].id], 'error');
    console.log('Five status shapes agree between panels and navigation, Busy alone turns in one phase or rests under reduced motion; theme, narrow-window and native-input checks passed.');
  },
};
