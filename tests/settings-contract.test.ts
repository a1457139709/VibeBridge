import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

const mattCommands = ['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'implement-spec', 'wayfinder', 'triage',
  'diagnosing-bugs', 'tdd', 'prototype', 'research', 'grill-me'];
const mattDeliveries = (delivery: 'submit' | 'fill') => Object.fromEntries(mattCommands.map(id => [id, { delivery }]));
const storedSettings = async (directory: string) => JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));

test('missing and invalid settings values fall back to their defaults field by field', async context => {
  const directory = await testDirectory(context, 'settings-contract-fallback');
  await writeFile(`${directory}/settings.json`, JSON.stringify({
    language: 'fr', theme: 'dark', defaultLayout: 42, sidebarCoexistence: 'float', detailCoexistence: 'beside',
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
      language: 'en', theme: 'dark', defaultLayout: 'auto', sidebarCoexistence: 'squeeze', detailCoexistence: 'overlay',
      agents: { codex: { command: 'codex', args: ['--yes'] }, claude: { command: ' custom-claude ', args: [] }, pi: { command: 'pi', args: [] } },
      shortcuts: {
        previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+K',
        maximizePanel: 'Command+Enter', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,',
        toggleForgeSidebar: 'Command+Alt+B', dispatch: 'Command+D', locateDispatch: 'Command+L',
      },
      workflows: { matt: { enabled: true, commands: mattDeliveries('submit') } },
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
    assert.equal(settings.sidebarCoexistence, 'squeeze');
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

test('the sidebar and detail coexistence chosen in Appearance are saved and read back', async context => {
  const directory = await testDirectory(context, 'settings-contract-sidebar-coexistence');
  let workbench = await Workbench.open(directory);
  try {
    assert.equal(workbench.snapshot().settings.sidebarCoexistence, 'squeeze');
    assert.equal(workbench.snapshot().settings.detailCoexistence, 'overlay', 'a detail overlays by default, so opening it resizes no terminal');
    assert.ok((await workbench.saveSettings({ sidebarCoexistence: 'overlay', detailCoexistence: 'squeeze' })).ok);
    await workbench.quit();
    const stored = await storedSettings(directory);
    assert.equal(stored.sidebarCoexistence, 'overlay');
    assert.equal(stored.detailCoexistence, 'squeeze');
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settings.sidebarCoexistence, 'overlay');
    assert.equal(workbench.snapshot().settings.detailCoexistence, 'squeeze');
    const invalid = await workbench.saveSettings({ sidebarCoexistence: 'float' as never });
    assert.equal(invalid.ok, false);
    const invalidDetail = await workbench.saveSettings({ detailCoexistence: 'beside' as never });
    assert.equal(invalidDetail.ok, false);
  } finally { await workbench.quit(); }
});

test('workflows turn Matt on with every command submitted, and invalid workflow values fall back value by value', async context => {
  const directory = await testDirectory(context, 'settings-contract-workflow-fallback');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ workflows: { matt: { enabled: 'yes', commands: {
    'to-spec': { delivery: 'fill' }, tdd: { delivery: 'paste' }, implement: 'fill', research: { delivery: 'fill' },
  } } } }));
  let workbench = await Workbench.open(directory);
  try {
    const { settings, errors } = workbench.snapshot();
    assert.deepEqual(errors, []);
    assert.deepEqual(settings.workflows, { matt: { enabled: true, commands: { ...mattDeliveries('submit'),
      'to-spec': { delivery: 'fill' }, research: { delivery: 'fill' } } } });
    await workbench.quit();
    for (const workflows of [['matt'], { matt: 'off' }, { matt: { enabled: false, commands: 'fill' } }]) {
      await writeFile(`${directory}/settings.json`, JSON.stringify({ workflows }));
      workbench = await Workbench.open(directory);
      assert.equal(workbench.snapshot().settings.workflows.matt.enabled, !('matt' in workflows && typeof workflows.matt === 'object'));
      assert.deepEqual(workbench.snapshot().settings.workflows.matt.commands, mattDeliveries('submit'));
      await workbench.quit();
    }
  } finally { await workbench.quit(); }
});

test('workflow choices are saved and read back, unknown workflows and commands stay, and invalid ones are refused', async context => {
  const directory = await testDirectory(context, 'settings-contract-workflows');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ workflows: {
    pstack: { enabled: true, commands: { poteto: { delivery: 'fill' } } },
    matt: { enabled: true, note: 'mine', commands: { retro: { delivery: 'fill' }, tdd: { delivery: 'submit', pinned: true } } },
  } }));
  let workbench = await Workbench.open(directory);
  try {
    const { workflows } = workbench.snapshot().settings;
    const saved = { ...workflows, matt: { ...workflows.matt, enabled: false,
      commands: { ...workflows.matt.commands, wayfinder: { delivery: 'fill' as const } } } };
    assert.ok((await workbench.saveSettings({ workflows: saved })).ok);
    await workbench.quit();
    const stored = (await storedSettings(directory)).workflows;
    assert.deepEqual(stored.pstack, { enabled: true, commands: { poteto: { delivery: 'fill' } } });
    assert.equal(stored.matt.note, 'mine');
    assert.deepEqual(stored.matt.commands.retro, { delivery: 'fill' });
    assert.deepEqual(stored.matt.commands.tdd, { delivery: 'submit', pinned: true });
    workbench = await Workbench.open(directory);
    assert.equal(workbench.snapshot().settings.workflows.matt.enabled, false);
    assert.equal(workbench.snapshot().settings.workflows.matt.commands.wayfinder.delivery, 'fill');
    assert.equal(workbench.snapshot().settings.workflows.matt.commands['to-spec'].delivery, 'submit');
    const invalid = await workbench.saveSettings({ workflows: { ...saved, matt: { ...saved.matt,
      commands: { ...saved.matt.commands, tdd: { delivery: 'paste' as never } } } } });
    assert.ok(!invalid.ok && invalid.kind === 'validation');
    assert.deepEqual(invalid.issues.map(issue => [issue.category, issue.field]), [['workflows', 'workflows.matt.commands.tdd.delivery']]);
    assert.equal(workbench.snapshot().settings.workflows.matt.commands.tdd.delivery, 'submit');
  } finally { await workbench.quit(); }
});
