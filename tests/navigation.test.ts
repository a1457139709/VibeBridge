import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

test('navigation preferences default open and survive project deletion and reopening independently from user settings', async context => {
  const directory = await testDirectory(context, 'navigation-persistence');
  let workbench = await Workbench.open(directory);
  try {
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 212 });
    await workbench.saveNavigation({ visible: false, width: 318 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: false, width: 318 });
    await workbench.quit();
    const settings = JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));
    assert.equal('navigation' in settings, false);
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().navigation, { visible: false, width: 318 });
    await workbench.saveNavigation({ visible: true, width: 318 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 318 });
    const agents = workbench.snapshot().settings.agents;
    agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings({ agents });
    const { project } = await workbench.createProject({ name: 'Navigation persistence', directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    await workbench.deleteProject(project.id);
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 318 });
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 318 });
    assert.equal(workbench.snapshot().projects.length, 0);
  } finally { await workbench.quit(); }
});

test('navigation remains usable for out-of-range widths and invalid requests do not replace saved preferences', async context => {
  const directory = await testDirectory(context, 'navigation-validation');
  const workbench = await Workbench.open(directory);
  try {
    await workbench.saveNavigation({ visible: false, width: 10000 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: false, width: 420 });
    await workbench.saveNavigation({ visible: true, width: 0 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 168 });
    await assert.rejects(workbench.saveNavigation({ visible: true, width: NaN }), /导航偏好无效/);
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 168 });
  } finally { await workbench.quit(); }
});
