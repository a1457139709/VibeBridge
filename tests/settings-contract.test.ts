import { message } from '../app/shared/messages';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';
import { defaultSettings, settingsCategories, settingsIssues } from '../app/shared/settings';

const mattDeliveries = (delivery: 'submit' | 'fill') => Object.fromEntries(['grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'implement-spec', 'wayfinder',
  'triage', 'diagnosing-bugs', 'tdd', 'prototype', 'research', 'grill-me'].map(id => [id, { delivery }]));
const storedSettings = async (directory: string) => JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));

test('missing and invalid settings values fall back to their defaults field by field', async context => {
  const directory = await testDirectory(context, 'settings-contract-fallback');
  await writeFile(`${directory}/settings.json`, JSON.stringify({
    language: 'fr', theme: 'dark', defaultLayout: 42, sidebarCoexistence: 'beside', detailCoexistence: 'beside',
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
      workflows: { matt: { enabled: true, instructions: mattDeliveries('submit') } },
      shortcuts: {
        previousProject: 'Command+Shift+[', nextProject: 'Command+Shift+]', previousPanel: 'Command+[', nextPanel: 'Command+K',
        maximizePanel: 'Command+Enter', addPanel: 'Command+N', closePanel: 'Command+Shift+W', settings: 'Command+,',
        toggleIssueSidebar: 'Command+Alt+B', dispatch: 'Command+D', locateDispatch: 'Command+L',
      },
    });
  } finally { await workbench.quit(); }
});

test('the dispatch and locate-dispatch shortcuts join the conflict check', async context => {
  const directory = await testDirectory(context, 'settings-contract-dispatch-shortcuts');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ shortcuts: { locateDispatch: 'Command+D', addPanel: 'Command+L' } }));
  const workbench = await Workbench.open(directory);
  try {
    const { settings, settingsConflicts } = workbench.snapshot();
    assert.deepEqual(settingsConflicts.map(issue => issue.field), ['shortcuts.dispatch', 'shortcuts.locateDispatch']);
    const result = await workbench.saveSettings({ shortcuts: { ...settings.shortcuts, addPanel: 'Command+N', dispatch: 'Command+Alt+D', locateDispatch: 'Command+L' } });
    assert.equal(result.ok, true);
    assert.deepEqual((await storedSettings(directory)).shortcuts, { ...defaultSettings().shortcuts, dispatch: 'Command+Alt+D' });
    assert.deepEqual(workbench.snapshot().settingsConflicts, []);
  } finally { await workbench.quit(); }
});

test('the issue sidebar can be set to overlay the layout area and its shortcut joins the conflict check', async context => {
  const directory = await testDirectory(context, 'settings-contract-issue-sidebar');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ sidebarCoexistence: 'overlay', shortcuts: { toggleIssueSidebar: 'Command+N' } }));
  const workbench = await Workbench.open(directory);
  try {
    const { settings, settingsConflicts } = workbench.snapshot();
    assert.equal(settings.sidebarCoexistence, 'overlay');
    assert.deepEqual(settingsConflicts.map(issue => issue.field), ['shortcuts.addPanel', 'shortcuts.toggleIssueSidebar']);
    const result = await workbench.saveSettings({ sidebarCoexistence: 'squeeze', shortcuts: { ...settings.shortcuts, toggleIssueSidebar: 'Command+Alt+B' } });
    assert.equal(result.ok, true);
    const stored = await storedSettings(directory);
    assert.equal(stored.sidebarCoexistence, 'squeeze');
    assert.equal(stored.shortcuts.toggleIssueSidebar, 'Command+Alt+B');
    assert.deepEqual(workbench.snapshot().settingsConflicts, []);
    const invalid = await workbench.saveSettings({ sidebarCoexistence: 'beside' as never });
    assert.equal(invalid.ok, false);
    assert.deepEqual(!invalid.ok && invalid.kind === 'validation' && invalid.issues.map(issue => [issue.field, issue.category]), [['sidebarCoexistence', 'appearance']]);
  } finally { await workbench.quit(); }
});

test('the issue detail can be set to squeeze the layout area and is checked with appearance', async context => {
  const directory = await testDirectory(context, 'settings-contract-issue-detail');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ detailCoexistence: 'squeeze' }));
  const workbench = await Workbench.open(directory);
  try {
    assert.equal(workbench.snapshot().settings.detailCoexistence, 'squeeze');
    assert.equal((await workbench.saveSettings({ detailCoexistence: 'overlay' })).ok, true);
    assert.equal((await storedSettings(directory)).detailCoexistence, 'overlay');
    const invalid = await workbench.saveSettings({ detailCoexistence: 'beside' as never });
    assert.deepEqual(!invalid.ok && invalid.kind === 'validation' && invalid.issues.map(issue => [issue.field, issue.category]), [['detailCoexistence', 'appearance']]);
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

test("workflows default to Matt's workflow switched on with every instruction submitted", async context => {
  const directory = await testDirectory(context, 'settings-contract-workflow-defaults');
  const workbench = await Workbench.open(directory);
  try {
    assert.deepEqual(workbench.snapshot().settings.workflows, { matt: { enabled: true, instructions: mattDeliveries('submit') } });
  } finally { await workbench.quit(); }
});

test('missing and invalid workflow values fall back to their defaults field by field', async context => {
  const cases: [string, unknown, unknown][] = [
    ['settings-contract-workflow-fields', { matt: { enabled: 'no', instructions: { 'to-spec': { delivery: 'fill' }, tdd: { delivery: 'paste' }, research: 'fill' } } },
      { matt: { enabled: true, instructions: { ...mattDeliveries('submit'), 'to-spec': { delivery: 'fill' } } } }],
    ['settings-contract-workflow-off', { matt: { enabled: false } }, { matt: { enabled: false, instructions: mattDeliveries('submit') } }],
    ['settings-contract-workflow-instructions', { matt: { enabled: false, instructions: ['fill'] } }, { matt: { enabled: false, instructions: mattDeliveries('submit') } }],
    ['settings-contract-workflow-entry', { matt: 'on' }, { matt: { enabled: true, instructions: mattDeliveries('submit') } }],
    ['settings-contract-workflows', ['matt'], { matt: { enabled: true, instructions: mattDeliveries('submit') } }],
  ];
  for (const [name, workflows, expected] of cases) {
    const directory = await testDirectory(context, name);
    await writeFile(`${directory}/settings.json`, JSON.stringify({ theme: 'dark', workflows }));
    const workbench = await Workbench.open(directory);
    try {
      const { settings, errors } = workbench.snapshot();
      assert.deepEqual(errors, []);
      assert.equal(settings.theme, 'dark');
      assert.deepEqual(settings.workflows, expected);
    } finally { await workbench.quit(); }
  }
});

test('unknown workflows and instructions stay in settings.json across saves', async context => {
  const directory = await testDirectory(context, 'settings-contract-workflow-unknown');
  await writeFile(`${directory}/settings.json`, JSON.stringify({ workflows: {
    pstack: { enabled: true, instructions: { 'poteto-mode': { delivery: 'fill' } } },
    matt: { enabled: true, color: 'blue', instructions: { retro: { delivery: 'fill' }, tdd: { delivery: 'submit', note: 'x' } } },
  } }));
  const workbench = await Workbench.open(directory);
  try {
    const { workflows } = workbench.snapshot().settings;
    assert.ok((await workbench.saveSettings({ workflows: { ...workflows, matt: { ...workflows.matt, enabled: false } } })).ok);
    await workbench.quit();
    const stored = (await storedSettings(directory)).workflows;
    assert.deepEqual(stored.pstack, { enabled: true, instructions: { 'poteto-mode': { delivery: 'fill' } } });
    assert.equal(stored.matt.enabled, false);
    assert.equal(stored.matt.color, 'blue');
    assert.deepEqual(stored.matt.instructions.retro, { delivery: 'fill' });
    assert.deepEqual(stored.matt.instructions.tdd, { delivery: 'submit', note: 'x' });
    assert.deepEqual(stored.matt.instructions['to-spec'], { delivery: 'submit' });
  } finally { await workbench.quit(); }
});

test('settings categories run General, Agent, Workflows, Appearance, Keyboard shortcuts, and workflows never conflict', () => {
  assert.deepEqual(settingsCategories.map(category => category.id), ['general', 'agents', 'workflows', 'appearance', 'shortcuts']);
  assert.deepEqual(settingsIssues({ ...defaultSettings(), workflows: { matt: { enabled: false, instructions: mattDeliveries('fill') } } }), []);
});

test('saving reports an invalid workflow value in the workflows category', async context => {
  const directory = await testDirectory(context, 'settings-contract-workflow-save');
  const workbench = await Workbench.open(directory);
  try {
    const { workflows } = workbench.snapshot().settings;
    const instructions = { ...workflows.matt.instructions, tdd: { delivery: 'paste' as 'fill' } };
    const result = await workbench.saveSettings({ workflows: { ...workflows, matt: { ...workflows.matt, instructions } } });
    if (result.ok || result.kind !== 'validation') assert.fail('Expected a field problem');
    assert.deepEqual(result.issues.map(issue => [issue.category, issue.field, issue.code]), [['workflows', 'workflows.matt.instructions.tdd.delivery', 'invalid']]);
  } finally { await workbench.quit(); }
});
