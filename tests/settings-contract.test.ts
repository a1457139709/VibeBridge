import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

const storedSettings = async (directory: string) => JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));

test('missing and invalid settings values fall back to their defaults field by field', async context => {
  const directory = await testDirectory(context, 'settings-contract-fallback');
  await writeFile(`${directory}/settings.json`, JSON.stringify({
    language: 'fr', theme: 'dark', defaultLayout: 42,
    agents: {
      codex: { command: '  ', args: ['--yes'] },
      claude: { command: ' custom-claude ', args: ['--a', 7] },
      pi: 'pi',
    },
    shortcuts: { nextPanel: 'Command+K', closePanel: 'Shift+W', addPanel: null },
  }));
  const workbench = await Workbench.open(directory);
  try {
    const { settings, errors, settingsConflicts } = workbench.snapshot();
    assert.deepEqual(errors, []);
    assert.deepEqual(settingsConflicts, []);
    assert.deepEqual(settings, {
      language: 'en', theme: 'dark', defaultLayout: 'auto',
      agents: { codex: { command: 'codex', args: ['--yes'] }, claude: { command: ' custom-claude ', args: [] }, pi: { command: 'pi', args: [] } },
      shortcuts: {
        previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+K',
        maximizePanel: 'Command+Enter', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,',
      },
    });
  } finally { await workbench.quit(); }
});

test('agents and shortcuts that are not objects fall back to their defaults as a whole', async context => {
  const directory = await testDirectory(context, 'settings-contract-category-fallback');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ theme: 'light', agents: ['codex'], shortcuts: 'Command+K' }));
  const workbench = await Workbench.open(directory);
  try {
    const { settings, errors } = workbench.snapshot();
    assert.deepEqual(errors, []);
    assert.equal(settings.theme, 'light');
    assert.deepEqual(settings.agents.codex, { command: 'codex', args: [] });
    assert.equal(settings.shortcuts.nextPanel, 'Command+]');
  } finally { await workbench.quit(); }
});

test('unknown keys at every level stay in settings.json across saves', async context => {
  const directory = await testDirectory(context, 'settings-contract-unknown-keys');
  await writeFile(`${directory}/settings.json`, JSON.stringify({
    fontSize: 14,
    agents: { codex: { command: 'codex', args: [], env: { DEBUG: '1' } }, gemini: { command: 'gemini', args: [] } },
    shortcuts: { oldAction: 'Command+J' },
  }));
  let workbench = await Workbench.open(directory);
  try {
    const { agents, shortcuts } = workbench.snapshot().settings;
    assert.ok((await workbench.saveSettings({ theme: 'dark' })).ok);
    assert.ok((await workbench.saveSettings({ agents: { ...agents, claude: { command: 'custom-claude', args: [] } } })).ok);
    assert.ok((await workbench.saveSettings({ shortcuts: { ...shortcuts, nextPanel: 'Command+K' } })).ok);
    await workbench.quit();
    const stored = await storedSettings(directory);
    assert.equal(stored.fontSize, 14);
    assert.deepEqual(stored.agents.codex.env, { DEBUG: '1' });
    assert.deepEqual(stored.agents.gemini, { command: 'gemini', args: [] });
    assert.equal(stored.agents.claude.command, 'custom-claude');
    assert.equal(stored.shortcuts.oldAction, 'Command+J');
    assert.equal(stored.shortcuts.nextPanel, 'Command+K');
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settings.theme, 'dark');
  } finally { await workbench.quit(); }
});

test('a settings file that is not a JSON object fails to read and is never overwritten', async context => {
  for (const [name, contents] of [['settings-contract-syntax', '{"theme": "dark",'], ['settings-contract-array', '["dark"]']]) {
    const directory = await testDirectory(context, name);
    await writeFile(`${directory}/settings.json`, contents);
    const workbench = await Workbench.open(directory);
    try {
      assert.match(workbench.snapshot().errors.join('\n'), /settingsReadFailed/);
      assert.equal(workbench.snapshot().settings.theme, 'system');
      assert.deepEqual(await workbench.saveSettings({ theme: 'dark' }), { ok: false, kind: 'storage', message: message('settingsUnreadable') });
      await assert.rejects(workbench.quit(), /settingsUnreadable/);
      assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), contents);
    } finally { await workbench.quit().catch(() => {}); }
  }
});
