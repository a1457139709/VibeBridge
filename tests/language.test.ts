import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';
import { localize } from '../app/shared/localization';

test('new and legacy settings default to English, while saved Chinese survives reopening with existing settings', async context => {
  const directory = await testDirectory(context, 'language-persistence');
  let workbench = await Workbench.open(directory);
  try {
    assert.equal(workbench.snapshot().settings.language, 'en');
    const { language: _language, ...legacy } = workbench.snapshot().settings;
    await workbench.quit();
    legacy.theme = 'dark';
    legacy.agents.codex = { command: '/custom-codex', args: ['--custom'] };
    await writeFile(`${directory}/settings.json`, JSON.stringify(legacy));
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().settings, { ...legacy, language: 'en' });
    assert.equal((await workbench.saveSettings({ language: 'zh-CN' })).ok, true);
    assert.equal(workbench.snapshot().settings.language, 'zh-CN');
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().settings, { ...legacy, language: 'zh-CN' });
  } finally { await workbench.quit(); }
});

test('a rejected whole settings submission retains the saved language and reports translatable field reasons', async context => {
  const directory = await testDirectory(context, 'language-validation');
  const workbench = await Workbench.open(directory);
  try {
    const before = workbench.snapshot().settings;
    const result = await workbench.saveSettings({ language: 'zh-CN', theme: 'dark',
      agents: { ...before.agents, codex: { command: '', args: [] } } });
    assert.ok(!result.ok && result.kind === 'validation');
    assert.deepEqual(workbench.snapshot().settings, before);
    assert.equal(localize('en').text(result.issues[0].message), 'Launch command is required');
    assert.equal(localize('zh-CN').text(result.issues[0].message), '启动命令不能为空');
  } finally { await workbench.quit(); }
});

test('project storage startup failures retain the saved language for native error presentation', async context => {
  const directory = await testDirectory(context, 'language-startup-failure');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ language: 'zh-CN', theme: 'dark' }));
  await writeFile(`${directory}/projects.sqlite`, 'not a SQLite database');
  await assert.rejects(Workbench.open(directory), error => {
    assert.ok(error instanceof Error);
    assert.equal(Reflect.get(error, 'language'), 'zh-CN');
    return true;
  });
});
