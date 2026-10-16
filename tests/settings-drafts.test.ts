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
    assert.equal(workbench.snapshot().settingsMigrationConflict, true);
    const result = await workbench.saveSettings({ theme: 'light' });
    assert.ok(!result.ok && result.kind === 'validation');
    assert.deepEqual(result.issues.map(issue => issue.field), ['shortcuts.nextPanel', 'shortcuts.closePanel']);
    await workbench.quit();
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settingsMigrationConflict, true);
    await workbench.saveSettings({ shortcuts: { ...settings.shortcuts, nextPanel: 'Command+K' } });
    assert.equal(workbench.snapshot().settingsMigrationConflict, false);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settingsMigrationConflict, false);
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
    assert.deepEqual(await workbench.saveSettings({ agents: { ...before.agents, codex: { command: '  ', args: [] } } }), {
      ok: false, kind: 'validation', issues: [{ category: 'agents', field: 'agents.codex.command', code: 'required', message: '启动命令不能为空' }],
    });
    const invalid = await workbench.saveSettings({ shortcuts: { ...before.shortcuts, closePanel: 'Shift+W' } });
    assert.ok(!invalid.ok && invalid.kind === 'validation');
    assert.equal(invalid.issues[0].field, 'shortcuts.closePanel');
    assert.equal(invalid.issues[0].code, 'invalid');
    assert.deepEqual(workbench.snapshot().settings, before);
    await workbench.saveSettings({ theme: 'light', defaultLayout: 'column' });
    await workbench.saveSettings({ shortcuts: { ...before.shortcuts, closePanel: 'Command+K' } });
    assert.deepEqual(workbench.snapshot().settings, { ...before, theme: 'light', defaultLayout: 'column', shortcuts: { ...before.shortcuts, closePanel: 'Command+K' } });
    const saved = workbench.snapshot().settings;
    await rm(`${directory}/settings.json`);
    await mkdir(`${directory}/settings.json`);
    assert.deepEqual(await workbench.saveSettings({ agents: { ...before.agents, pi: { command: '/not-installed-but-valid', args: [] } } }), { ok: false, kind: 'storage', message: '配置保存失败' });
    assert.deepEqual(workbench.snapshot().settings, saved);
    await rm(`${directory}/settings.json`, { recursive: true });
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('missing-action migration does not excuse duplicate bindings already present in the old file', async () => {
  await mkdir('work/issue-47', { recursive: true });
  const directory = await mkdtemp(resolve('work/issue-47/invalid-legacy-'));
  let workbench = await Workbench.open(directory);
  const settings = workbench.snapshot().settings;
  await workbench.quit();
  const { closePanel: _missing, ...old } = settings.shortcuts;
  const original = JSON.stringify({ ...settings, shortcuts: { ...old, nextPanel: 'Command+Shift+W', previousPanel: 'Command+Shift+W' } });
  await writeFile(`${directory}/settings.json`, original);
  workbench = await Workbench.open(directory);
  try {
    assert.match(workbench.snapshot().errors.join('\n'), /快捷键冲突/);
    assert.deepEqual(await workbench.saveSettings({ theme: 'dark' }), { ok: false, kind: 'storage', message: '配置读取失败，未覆盖原配置；请修正后重新启动' });
    await assert.rejects(workbench.quit(), /未覆盖原配置/);
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
  } finally { await workbench.quit().catch(() => {}); await rm(directory, { recursive: true, force: true }); }
});
