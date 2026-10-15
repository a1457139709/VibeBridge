const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = {
  async run({ window, evaluate, until, directory }) {
    await until(() => evaluate('!!document.querySelector(".setup")'));
    for (const name of ['first', 'second']) {
      const path = join(directory, name); await mkdir(path);
      await evaluate(`window.workbench.createProject(${JSON.stringify({ name, directory: path, total: 2, counts: { codex: 2, claude: 0, pi: 0 } })})`);
    }
    const snapshot = await evaluate('window.workbench.snapshot()');
    const [a, b] = snapshot.projects.map(project => project.id);
    const [[a1, a2], [b1, b2]] = snapshot.projects.map(project => project.panels.map(panel => panel.id));
    const bundle = await build({ entryPoints: ['tests/fixtures/panel-location.tsx'], bundle: true, write: false,
      format: 'iife', globalName: 'PanelLocationFixture', platform: 'browser' });
    await evaluate(bundle.outputFiles[0].text);
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const act = async code => { await evaluate(code); await settle(); };
    const fresh = async () => {
      await act(`window.fixture?.dispose(); window.fixture = PanelLocationFixture.createFixture(${JSON.stringify(snapshot)}); void 0`);
      await until(() => focused(a1));
    };
    const focused = id => evaluate(`document.activeElement?.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(id)} && document.activeElement?.classList.contains('xterm-helper-textarea')`);
    const view = id => evaluate(`window.fixture.location.view(${JSON.stringify(id)})`);
    const locate = (project, panel) => act(`window.fixture.location.locatePanel(${JSON.stringify(project)}, ${JSON.stringify(panel)})`);
    const finish = async (index, project) => {
      await act(`window.fixture.snapshot({ activeProjectId: ${JSON.stringify(project)} }); window.fixture.requests[${index}].resolve()`);
      await until(() => evaluate('!window.fixture.location.locating'));
    };
    window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      await fresh();
      assert.equal(await evaluate(`(() => { window.fixture.workspace.focus(${JSON.stringify(a2)}); return document.activeElement?.closest('[data-panel-id]')?.dataset.panelId; })()`), a2, 'Header focus is immediate for a mounted terminal');
      assert.equal(await evaluate(`(() => { window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)}); return document.activeElement?.closest('[data-panel-id]')?.dataset.panelId; })()`), a1, 'Maximize cannot send immediate input to the previous panel');
      console.log('PASS: mounted header/maximize interactions preserve immediate native input focus.');
      await fresh();
      await act('window.fixture.outside()');
      await locate(a, a1);
      assert.equal(await focused(a1), false, 'An activation acknowledgement is still pending');
      await locate(b, 'missing');
      assert.equal(await evaluate('window.fixture.location.locating && window.fixture.requests.length === 1'), true, 'Invalid requests cannot replace a valid pending operation');
      await finish(0, a);
      assert.equal(await focused(a1), true, 'Repeated location restores real xterm input focus');
      assert.deepEqual(await view(a), { selected: a1, maximized: undefined });
      console.log('PASS: repeated location uses the public hooks and real terminal focus.');

      await fresh();
      await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)})`);
      await locate(b, b2);
      await act('window.fixture.outside(); window.fixture.requests[0].resolve()');
      assert.equal(await evaluate('window.fixture.location.locating'), true, 'IPC completion does not mean target DOM exists');
      assert.equal(await focused(a1), false);
      await act(`window.fixture.update({ attached: false }); window.fixture.snapshot({ activeProjectId: ${JSON.stringify(b)} })`);
      assert.equal(await evaluate('window.fixture.location.locating'), true, 'A target snapshot without Workspace still waits');
      await act('window.fixture.update({ attached: true, terminals: false })');
      assert.equal(await evaluate('window.fixture.location.locating'), true, 'Mounted panel without its running terminal still waits');
      assert.equal(await focused(b2), false);
      const newestRuns = snapshot.runs.map(run => run.panelId === b2 ? { ...run, rawTitle: 'Newest title | directory' } : run);
      await act(`window.fixture.snapshot({ runs: ${JSON.stringify(newestRuns)} }); window.fixture.update({ terminals: true })`);
      await until(() => focused(b2));
      await until(() => evaluate('!window.fixture.location.locating'));
      assert.deepEqual(await view(b), { selected: b2, maximized: b2 });
      assert.deepEqual(await evaluate('window.fixture.notices'), [{ message: '已切换至：Newest title', kind: 'success' }], 'Programmatic focus feedback must not cancel its own completion; notice uses the latest title');
      await act(`window.fixture.location.openProject(${JSON.stringify(a)})`); await finish(1, a);
      assert.deepEqual(await view(a), { selected: a1, maximized: a1 });
      assert.equal(await focused(a1), true);
      console.log('PASS: activation, committed Workspace and real terminal readiness are distinct; normal remount continues, feedback completes and latest title is used.');

      await fresh();
      await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)})`);
      await locate(b, b2); await locate(a, a2);
      // The old backend operation can still publish B. Neither its callback nor
      // the ordinary Workspace mount may focus that rejected destination.
      await act(`window.fixture.outside(); window.fixture.snapshot({ activeProjectId: ${JSON.stringify(b)} }); window.fixture.requests[0].resolve()`);
      assert.equal(await focused(b2), false);
      assert.deepEqual(await evaluate('window.fixture.notices'), []);
      await finish(1, a);
      assert.equal(await focused(a2), true);
      assert.deepEqual(await evaluate('window.fixture.notices'), [{ message: '已切换至：Untitled task', kind: 'success' }]);
      console.log('PASS: a newer accepted location supersedes old activation and ignores its late snapshot, focus and notice.');

      for (const kind of ['leave', 'hide', 'unmount']) {
        await fresh(); await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)})`); await locate(b, b2);
        const command = kind === 'leave' ? 'window.fixture.location.leaveWorkbench(() => window.fixture.update({ visible: false }))'
          : kind === 'hide' ? 'window.fixture.update({ visible: false })' : 'window.fixture.dispose()';
        await act(`${command}; ${kind === 'unmount' ? '' : 'window.fixture.outside();'} window.fixture.requests[0].resolve()`);
        if (kind !== 'unmount') {
          await act(`window.fixture.snapshot({ activeProjectId: ${JSON.stringify(b)} })`);
          assert.equal(await evaluate('window.fixture.location.locating'), false);
          assert.equal(await focused(b2), false);
        }
        assert.deepEqual(await evaluate('window.fixture.notices'), [], `${kind} prevents late success`);
        if (kind === 'unmount') await evaluate('window.fixture = undefined');
      }
      console.log('PASS: leaving, hidden context and root unmount cancel pending work and late completions.');

      await fresh(); await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)})`); await locate(b, b2);
      const removed = snapshot.projects.map(project => project.id === b ? { ...project, panels: project.panels.filter(panel => panel.id !== b2) } : project);
      await act(`window.fixture.snapshot({ projects: ${JSON.stringify(removed)} })`);
      assert.equal(await evaluate('window.fixture.location.locating'), false);
      assert.deepEqual(await view(b), { selected: b1, maximized: undefined });
      await finish(0, b);
      assert.deepEqual(await evaluate('window.fixture.notices'), [], 'Fallback panel is not the original successful target');
      await act(`window.fixture.location.locatePanel(${JSON.stringify(b)}, 'missing')`);
      assert.equal(await evaluate('window.fixture.requests.length'), 1, 'Invalid commands do not activate a project');
      console.log('PASS: vanished targets terminate location and repair selection/maximize consistently.');

      await fresh();
      const stopped = snapshot.runs.map(run => run.panelId === a2 ? { ...run, state: 'failed' } : run);
      await act(`window.fixture.snapshot({ runs: ${JSON.stringify(stopped)} })`);
      await locate(a, a2); await finish(0, a);
      assert.deepEqual(await view(a), { selected: a2, maximized: undefined });
      assert.equal(await focused(a2), false, 'A displayed failed run is not an input focus success');
      assert.equal(await focused(a1), false, 'The previous terminal must not keep receiving input for a failed destination');
      await act(`window.fixture.snapshot({ runs: ${JSON.stringify(snapshot.runs)} })`);
      await until(() => focused(a2));
      console.log('PASS: displaying a non-running panel differs from terminal focus; a later running terminal receives focus.');

      await fresh();
      await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)}); window.fixture.update({ animations: true })`);
      await locate(b, b2);
      await act(`window.fixture.location.leaveWorkbench(() => window.fixture.update({ visible: false }))`);
      await until(() => evaluate('!window.fixture.host.getAnimations({ subtree: true }).length'));
      assert.equal(await evaluate('window.fixture.requests.length'), 0, 'Cancellation during outgoing animation never activates the target');
      assert.deepEqual(await evaluate('window.fixture.notices'), []);

      await fresh(); await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a1)}); window.fixture.update({ animations: true })`);
      await locate(b, b2);
      await until(() => evaluate('window.fixture.requests.length === 1'));
      await act(`window.fixture.snapshot({ activeProjectId: ${JSON.stringify(b)} }); window.fixture.requests[0].resolve()`);
      await until(() => focused(b2));
      await act(`window.fixture.location.openProject(${JSON.stringify(a)})`);
      await finish(1, a);
      assert.equal(await focused(a1), true);
      await until(() => evaluate('!window.fixture.host.getAnimations({ subtree: true }).length'));
      assert.deepEqual(await evaluate('window.fixture.notices'), []);
      console.log('PASS: outgoing and incoming native animations are cancelled by the next accepted command.');

      await fresh();
      await act('window.fixture.workspace.move(1)'); await finish(0, a);
      assert.deepEqual(await view(a), { selected: a2, maximized: undefined }, 'Panel navigation follows caller-provided spatial order');
      await act(`window.fixture.workspace.toggleMaximize(${JSON.stringify(a2)}); window.fixture.workspace.panelAdded()`);
      assert.deepEqual(await view(a), { selected: a2, maximized: undefined });
      await locate(b, b1);
      await act(`window.fixture.workspace.focus(${JSON.stringify(a1)})`);
      await finish(1, b);
      assert.equal(await focused(b1), false, 'A direct panel interaction replaces pending navigation');
      assert.deepEqual(await evaluate('window.fixture.notices'), []);
      console.log('PASS: spatial navigation, local focus/maximize and add-panel restore share view validity without adding navigation animations.');

      await fresh(); await locate(b, b1); await locate(a, a2);
      await act('window.fixture.requests[0].reject(new Error("old activation failed"))');
      assert.deepEqual(await evaluate('window.fixture.notices'), [], 'A stale rejection cannot report for the new operation');
      await act('window.fixture.requests[1].reject(new Error("current activation failed"))');
      assert.equal(await evaluate('window.fixture.location.locating'), false);
      assert.deepEqual(await evaluate('window.fixture.notices'), [{ message: 'current activation failed', kind: undefined }]);
      console.log('PASS: only the accepted activation reports failure and releases its pending presentation.');
    } finally {
      await evaluate('window.fixture?.dispose(); window.fixture = undefined');
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      window.webContents.debugger.detach();
    }
  },
};
