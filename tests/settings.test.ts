import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';

test('saved preferences apply at their intended boundaries and manual edits apply on reopen', async () => {
  await mkdir('work/issue-27', { recursive: true });
  const directory = await mkdtemp(resolve('work/issue-27/settings-'));
  let workbench = await Workbench.open(directory, true);
  try {
    assert.equal(workbench.snapshot().startupTheme, 'system');
    assert.equal(workbench.snapshot().resolvedTheme, 'dark');
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Settings', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const runs = workbench.snapshot().runs;
    assert.equal(runs.length, 2);
    assert.ok(runs.every(run => run.state === 'running'));
    const layout = { axis: 'row' as const, ratio: 0.7, first: { panel: project.panels[1].id }, second: { panel: project.panels[0].id } };
    await workbench.saveLayout(project.id, layout);
    await Promise.all([
      workbench.saveSettings({ theme: 'light', defaultLayout: 'column' }),
      workbench.saveSettings({ agents: { ...settings.agents, codex: { command: '/missing-agent', args: ['changed'] } } }),
    ]);
    assert.equal(workbench.snapshot().resolvedTheme, 'dark');
    assert.equal(workbench.snapshot().startupTheme, 'system');
    assert.deepEqual(workbench.snapshot().runs, runs);
    assert.deepEqual(workbench.snapshot().projects[0].layout, layout);
    const added = await workbench.addPanel(project.id, 'codex');
    assert.equal(added.launch.ok, false);
    assert.deepEqual(workbench.snapshot().runs.slice(0, 2), runs);
    await workbench.closePanel(project.id, added.panel.id);
    const nextDirectory = resolve(directory, 'next');
    await mkdir(nextDirectory);
    const next = await workbench.createProject({ name: 'New layout', directory: nextDirectory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
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
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('shortcut conflicts name the existing action and retain effective bindings until a valid save', async () => {
  await mkdir('work/issue-27', { recursive: true });
  const directory = await mkdtemp(resolve('work/issue-27/shortcuts-'));
  const workbench = await Workbench.open(directory);
  try {
    const original = workbench.snapshot().settings.shortcuts;
    const shortcuts = { ...original, nextPanel: 'Command+K' };
    await workbench.saveSettings({ shortcuts });
    assert.equal(workbench.snapshot().settings.shortcuts.nextPanel, 'Command+K');
    await assert.rejects(workbench.saveSettings({ shortcuts: { ...shortcuts, maximizePanel: 'Command+K' } }), /下一个面板/);
    await assert.rejects(workbench.saveSettings({ shortcuts: { ...shortcuts, previousPanel: 'Command+K' } }), /下一个面板/);
    assert.deepEqual(workbench.snapshot().settings.shortcuts, shortcuts);
    await assert.rejects(workbench.saveSettings({ shortcuts: { ...shortcuts, nextPanel: 'Command+C' } }), /复制/);
    assert.deepEqual(workbench.snapshot().settings.shortcuts, shortcuts);
    await workbench.saveSettings({ shortcuts: original });
    assert.deepEqual(workbench.snapshot().settings.shortcuts, original);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});
