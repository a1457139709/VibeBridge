import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';

test('legacy shortcuts gain close-panel and a newly introduced default conflict remains editable without failing quit or rewriting the file', async () => {
  await mkdir('work/issue-47', { recursive: true });
  const directory = await mkdtemp(resolve('work/issue-47/migration-'));
  const original = JSON.stringify({ theme: 'dark', defaultLayout: 'row', agents: {
    codex: { command: 'custom-codex', args: ['custom'] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
  }, shortcuts: { previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+Shift+W', maximizePanel: 'Command+Enter', addPanel: 'Command+N', settings: 'Command+,' } });
  await writeFile(`${directory}/settings.json`, original);
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    assert.equal(settings.shortcuts.closePanel, 'Command+Shift+W');
    assert.equal(settings.shortcuts.nextPanel, 'Command+Shift+W');
    assert.equal(settings.agents.codex.command, 'custom-codex');
    assert.deepEqual(workbench.snapshot().errors, []);
    await assert.rejects(workbench.saveSettings({ theme: 'light' }), /快捷键冲突/);
    await workbench.quit();
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
    workbench = await Workbench.open(directory);
    await workbench.saveSettings({ shortcuts: { ...settings.shortcuts, nextPanel: 'Command+K' } });
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settings.shortcuts.closePanel, 'Command+Shift+W');
    assert.equal(workbench.snapshot().settings.shortcuts.nextPanel, 'Command+K');
    assert.equal(workbench.snapshot().settings.theme, 'dark');
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('empty Agent commands return field errors while failed partial saves retain every effective category', async () => {
  await mkdir('work/issue-47', { recursive: true });
  const directory = await mkdtemp(resolve('work/issue-47/validation-'));
  const workbench = await Workbench.open(directory);
  try {
    const before = workbench.snapshot().settings;
    await assert.rejects(workbench.saveSettings({ agents: { ...before.agents, codex: { command: '  ', args: [] } } }), error => {
      assert.match((error as Error).message, /启动命令不能为空/);
      assert.doesNotMatch((error as Error).message, /配置文件损坏/);
      assert.equal((error as Error & { fields: Record<string, string> }).fields['agents.codex.command'], '启动命令不能为空');
      return true;
    });
    assert.deepEqual(workbench.snapshot().settings, before);
    await workbench.saveSettings({ theme: 'light', defaultLayout: 'column' });
    await workbench.saveSettings({ shortcuts: { ...before.shortcuts, closePanel: 'Command+K' } });
    assert.deepEqual(workbench.snapshot().settings, { ...before, theme: 'light', defaultLayout: 'column', shortcuts: { ...before.shortcuts, closePanel: 'Command+K' } });
    const saved = workbench.snapshot().settings;
    await rm(`${directory}/settings.json`);
    await mkdir(`${directory}/settings.json`);
    await assert.rejects(workbench.saveSettings({ agents: { ...before.agents, pi: { command: '/not-installed-but-valid', args: [] } } }), /配置保存失败/);
    assert.deepEqual(workbench.snapshot().settings, saved);
    await rm(`${directory}/settings.json`, { recursive: true });
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});
