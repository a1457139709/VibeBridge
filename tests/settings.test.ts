import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

test('saved preferences apply at their intended boundaries and manual edits apply on reopen', async context => {
  const directory = await testDirectory(context, 'settings-persistence');
  let workbench = await Workbench.open(directory, true);
  try {
    assert.equal(workbench.snapshot().startupTheme, 'system');
    assert.equal(workbench.snapshot().resolvedTheme, 'dark');
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    settings.agents.claude = settings.agents.codex;
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Settings', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const runs = workbench.snapshot().runs;
    assert.equal(runs.length, 2);
    assert.ok(runs.every(run => run.state === 'running'));
    const layout = { axis: 'row' as const, ratio: 0.7, first: { panel: project.panels[1].id }, second: { panel: project.panels[0].id } };
    await workbench.saveLayout(project.id, layout);
    await Promise.all([
      workbench.saveSettings({ language: 'zh-CN', theme: 'light', defaultLayout: 'column' }),
      workbench.saveSettings({ agents: { ...settings.agents, codex: { command: '/missing-agent', args: ['changed'] } } }),
    ]);
    assert.equal(workbench.snapshot().resolvedTheme, 'dark');
    assert.equal(workbench.snapshot().startupTheme, 'system');
    assert.deepEqual(workbench.snapshot().runs, runs);
    assert.deepEqual(workbench.snapshot().projects[0].layout, layout);
    const added = await workbench.addPanel(project.id, 'codex');
    assert.equal(added.launch.outcome, 'failed');
    assert.deepEqual(workbench.snapshot().runs, runs);
    assert.deepEqual(workbench.snapshot().projects[0], { ...project, layout });
    const nextDirectory = resolve(directory, 'next');
    await mkdir(nextDirectory);
    const next = await workbench.createProject({ name: 'New layout', directory: nextDirectory, total: 2, counts: { codex: 0, claude: 2, pi: 0 } });
    assert.equal(next.project.layout && 'axis' in next.project.layout && next.project.layout.axis, 'column');
    await workbench.quit();
    workbench = await Workbench.open(directory, true);
    assert.equal(workbench.snapshot().resolvedTheme, 'light');
    assert.equal(workbench.snapshot().settings.agents.codex.command, '/missing-agent');
    assert.deepEqual(workbench.snapshot().projects[0].layout, layout);
    await workbench.quit();
    await writeFile(resolve(directory, 'settings.json'), JSON.stringify({ ...workbench.snapshot().settings, theme: 'dark' }));
    workbench = await Workbench.open(directory, false);
    assert.equal(workbench.snapshot().resolvedTheme, 'dark');
  } finally { await workbench.quit(); }
});

test('shortcut conflicts name the existing action and retain effective bindings until a valid save', async context => {
  const directory = await testDirectory(context, 'settings-shortcuts');
  const workbench = await Workbench.open(directory);
  try {
    const original = workbench.snapshot().settings.shortcuts;
    const shortcuts = { ...original, nextPanel: 'Command+K' };
    await workbench.saveSettings({ shortcuts });
    assert.equal(workbench.snapshot().settings.shortcuts.nextPanel, 'Command+K');
    for (const [patch, message] of [
      [{ maximizePanel: 'Command+K' }, /nextPanel/], [{ previousPanel: 'Command+K' }, /nextPanel/], [{ nextPanel: 'Command+C' }, /copy/],
    ] as const) {
      const result = await workbench.saveSettings({ shortcuts: { ...shortcuts, ...patch } });
      assert.ok(!result.ok && result.kind === 'validation');
      assert.match(result.issues.map(issue => issue.message).join('；'), message);
      assert.deepEqual(workbench.snapshot().settings.shortcuts, shortcuts);
    }
    await workbench.saveSettings({ shortcuts: original });
    assert.deepEqual(workbench.snapshot().settings.shortcuts, original);
  } finally { await workbench.quit(); }
});
