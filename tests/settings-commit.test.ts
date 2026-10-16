import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';

test.before(async () => { await mkdir('work/issue-65', { recursive: true }); });

test('a settings submission reports every field problem and commits none of its categories', async () => {
  const directory = await mkdtemp(resolve('work/issue-65/validation-'));
  const workbench = await Workbench.open(directory);
  try {
    const before = workbench.snapshot().settings;
    await workbench.saveSettings(before);
    const original = await readFile(`${directory}/settings.json`, 'utf8');
    const result = await workbench.saveSettings({
      agents: { ...before.agents, codex: { command: '', args: [] }, pi: { command: '  ', args: [] } },
      theme: 'dark',
      shortcuts: { ...before.shortcuts, nextPanel: 'Command+C', closePanel: 'Shift+W', settings: 'Command+N' },
    });
    assert.equal(result.ok, false);
    if (result.ok || result.kind !== 'validation') assert.fail('Expected field problems');
    assert.deepEqual(result.issues.map(issue => [issue.category, issue.field, issue.code]), [
      ['agents', 'agents.codex.command', 'required'], ['agents', 'agents.pi.command', 'required'],
      ['shortcuts', 'shortcuts.closePanel', 'invalid'],
      ['shortcuts', 'shortcuts.nextPanel', 'conflict'], ['shortcuts', 'shortcuts.addPanel', 'conflict'], ['shortcuts', 'shortcuts.settings', 'conflict'],
    ]);
    assert.deepEqual(workbench.snapshot().settings, before);
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
    const saved = await workbench.saveSettings({ agents: { ...before.agents, pi: { command: '/unavailable-but-valid', args: [] } }, theme: 'dark' });
    assert.equal(saved.ok, true);
    assert.equal(workbench.snapshot().settings.theme, 'dark');
    assert.equal(workbench.snapshot().settings.agents.pi.command, '/unavailable-but-valid');
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('a real whole-submission write failure preserves the file and current settings, then retries as one commit', async () => {
  const directory = await mkdtemp(resolve('work/issue-65/write-'));
  let workbench = await Workbench.open(directory);
  try {
    const before = workbench.snapshot().settings;
    await workbench.saveSettings(before);
    const original = await readFile(`${directory}/settings.json`, 'utf8');
    const patch = { agents: { ...before.agents, pi: { command: '/new-pi', args: ['new'] } }, theme: 'dark' as const,
      defaultLayout: 'column' as const, shortcuts: { ...before.shortcuts, nextPanel: 'Command+K' } };
    await chmod(`${directory}/settings.json`, 0o400);
    await chmod(directory, 0o500);
    try {
      assert.deepEqual(await workbench.saveSettings(patch), { ok: false, kind: 'storage', message: '配置保存失败' });
      assert.deepEqual(workbench.snapshot().settings, before);
      assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
    } finally { await chmod(directory, 0o700); await chmod(`${directory}/settings.json`, 0o600); }
    const result = await workbench.saveSettings(patch);
    assert.deepEqual(result, { ok: true, settings: { ...before, ...patch } });
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().settings, { ...before, ...patch });
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});
