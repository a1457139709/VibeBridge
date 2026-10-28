import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

// nextPanel is written with closePanel's binding; maximizePanel is missing and its default matches nothing.
async function writeShortcutConflict(directory: string) {
  const contents = JSON.stringify({ theme: 'dark', defaultLayout: 'row', agents: {
    codex: { command: 'custom-codex', args: ['custom'] }, claude: { command: 'claude', args: [] }, pi: { command: 'pi', args: [] },
  }, shortcuts: { previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+Shift+W', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,' } });
  await writeFile(`${directory}/settings.json`, contents);
}
const storedSettings = async (directory: string) => JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));
const conflictFields = (workbench: Workbench) => workbench.snapshot().settingsConflicts.map(issue => [issue.category, issue.field]);

test('a settings conflict takes effect at startup, and quitting writes it back for the next startup to report again', async context => {
  const directory = await testDirectory(context, 'settings-conflict-startup');
  await writeShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    const { settings, errors } = workbench.snapshot();
    assert.equal(settings.shortcuts.closePanel, 'Command+Shift+W');
    assert.equal(settings.shortcuts.nextPanel, 'Command+Shift+W');
    assert.equal(settings.agents.codex.command, 'custom-codex');
    assert.deepEqual(errors, []);
    assert.deepEqual(conflictFields(workbench), [['shortcuts', 'shortcuts.nextPanel'], ['shortcuts', 'shortcuts.closePanel']]);
    await workbench.quit();
    assert.deepEqual(await storedSettings(directory), settings);
    workbench = await Workbench.open(directory);
    assert.deepEqual(conflictFields(workbench), [['shortcuts', 'shortcuts.nextPanel'], ['shortcuts', 'shortcuts.closePanel']]);
  } finally { await workbench.quit(); }
});

test('a settings conflict blocks saving its own category but not the others', async context => {
  const directory = await testDirectory(context, 'settings-conflict-other-category');
  await writeShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    assert.ok((await workbench.saveSettings({ theme: 'light' })).ok);
    assert.equal(workbench.snapshot().settings.theme, 'light');
    assert.equal((await storedSettings(directory)).theme, 'light');
    assert.equal(workbench.snapshot().settingsConflicts.length, 2);
    const unresolved = await workbench.saveSettings({ shortcuts: workbench.snapshot().settings.shortcuts });
    assert.ok(!unresolved.ok && unresolved.kind === 'validation');
    assert.deepEqual(unresolved.issues.map(issue => [issue.field, issue.code]), [['shortcuts.nextPanel', 'conflict'], ['shortcuts.closePanel', 'conflict']]);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settingsConflicts.length, 2);
    assert.equal(workbench.snapshot().settings.theme, 'light');
  } finally { await workbench.quit(); }
});

test('saving settings that resolve a settings conflict clears it', async context => {
  const directory = await testDirectory(context, 'settings-conflict-resolved');
  await writeShortcutConflict(directory);
  let workbench = await Workbench.open(directory);
  try {
    const shortcuts = { ...workbench.snapshot().settings.shortcuts, nextPanel: 'Command+K' };
    assert.ok((await workbench.saveSettings({ shortcuts })).ok);
    assert.deepEqual(workbench.snapshot().settingsConflicts, []);
    assert.deepEqual((await storedSettings(directory)).shortcuts, shortcuts);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().settingsConflicts, []);
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
