import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

// closePanel is missing, so its default Command+Shift+W matches the user's nextPanel binding.
// maximizePanel is missing too, and its default matches nothing.
async function writeDefaultShortcutConflict(directory: string) {
  const contents = JSON.stringify({ theme: 'dark', defaultLayout: 'row', agents: {
    codex: { command: 'custom-codex', args: ['custom'] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
  }, shortcuts: { previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+Shift+W', addPanel: 'Command+N', settings: 'Command+,' } });
  await writeFile(`${directory}/settings.json`, contents);
  return contents;
}
const storedSettings = async (directory: string) => JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));

test('a default shortcut conflict is reported at startup and quitting leaves settings.json untouched', async context => {
  const directory = await testDirectory(context, 'settings-default-conflict-startup');
  const original = await writeDefaultShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    const { settings, errors, defaultShortcutConflict } = workbench.snapshot();
    assert.equal(settings.shortcuts.closePanel, 'Command+Shift+W');
    assert.equal(settings.shortcuts.nextPanel, 'Command+Shift+W');
    assert.equal(settings.shortcuts.maximizePanel, 'Command+Enter');
    assert.equal(settings.agents.codex.command, 'custom-codex');
    assert.deepEqual(errors, []);
    assert.equal(defaultShortcutConflict, true);
    await workbench.quit();
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().defaultShortcutConflict, true);
  } finally { await workbench.quit(); }
});

test('saving another category during a default shortcut conflict persists it without the conflicting default', async context => {
  const directory = await testDirectory(context, 'settings-default-conflict-other-category');
  await writeDefaultShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    assert.ok((await workbench.saveSettings({ theme: 'light' })).ok);
    assert.equal(workbench.snapshot().settings.theme, 'light');
    assert.equal(workbench.snapshot().defaultShortcutConflict, true);
    const stored = await storedSettings(directory);
    assert.equal(stored.theme, 'light');
    assert.equal('closePanel' in stored.shortcuts, false);
    assert.equal(stored.shortcuts.maximizePanel, 'Command+Enter');
    const unresolved = await workbench.saveSettings({ shortcuts: workbench.snapshot().settings.shortcuts });
    assert.ok(!unresolved.ok && unresolved.kind === 'validation');
    assert.deepEqual(unresolved.issues.map(issue => issue.field), ['shortcuts.nextPanel', 'shortcuts.closePanel']);
    assert.equal(workbench.snapshot().defaultShortcutConflict, true);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().defaultShortcutConflict, true);
    assert.equal(workbench.snapshot().settings.theme, 'light');
  } finally { await workbench.quit(); }
});

test('saving shortcuts that resolve a default shortcut conflict clears it and persists every action', async context => {
  const directory = await testDirectory(context, 'settings-default-conflict-resolved');
  await writeDefaultShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    const shortcuts = { ...workbench.snapshot().settings.shortcuts, nextPanel: 'Command+K' };
    assert.ok((await workbench.saveSettings({ shortcuts })).ok);
    assert.equal(workbench.snapshot().defaultShortcutConflict, false);
    assert.deepEqual((await storedSettings(directory)).shortcuts, shortcuts);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().defaultShortcutConflict, false);
    assert.deepEqual(workbench.snapshot().settings.shortcuts, shortcuts);
    assert.equal(workbench.snapshot().settings.theme, 'dark');
  } finally { await workbench.quit(); }
});

test('empty Agent commands return field errors while failed partial saves retain every effective category', async context => {
  const directory = await testDirectory(context, 'settings-drafts-validation');
  const workbench = await Workbench.open(directory);
  try {
    const before = workbench.snapshot().settings;
    assert.deepEqual(await workbench.saveSettings({ agents: { ...before.agents, codex: { command: '  ', args: [] } } }), {
      ok: false, kind: 'validation', issues: [{ category: 'agents', field: 'agents.codex.command', code: 'required', message: message('commandRequired') }],
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
    assert.deepEqual(await workbench.saveSettings({ agents: { ...before.agents, pi: { command: '/not-installed-but-valid', args: [] } } }), { ok: false, kind: 'storage', message: message('settingsWriteFailed') });
    assert.deepEqual(workbench.snapshot().settings, saved);
    await rm(`${directory}/settings.json`, { recursive: true });
  } finally { await workbench.quit(); }
});

test('user-written duplicate bindings are not excused by a default shortcut conflict', async context => {
  const directory = await testDirectory(context, 'settings-user-written-conflicts');
  let workbench = await Workbench.open(directory);
  const settings = workbench.snapshot().settings;
  await workbench.quit();
  const { closePanel: _missing, ...written } = settings.shortcuts;
  const original = JSON.stringify({ ...settings, shortcuts: { ...written, nextPanel: 'Command+Shift+W', previousPanel: 'Command+Shift+W' } });
  await writeFile(`${directory}/settings.json`, original);
  workbench = await Workbench.open(directory);
  try {
    assert.match(workbench.snapshot().errors.join('\n'), /shortcutConflict/);
    assert.deepEqual(await workbench.saveSettings({ theme: 'dark' }), { ok: false, kind: 'storage', message: message('settingsUnreadable') });
    await assert.rejects(workbench.quit(), /settingsUnreadable/);
    assert.equal(await readFile(`${directory}/settings.json`, 'utf8'), original);
  } finally { await workbench.quit().catch(() => {}); }
});
