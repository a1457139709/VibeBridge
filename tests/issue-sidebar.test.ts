import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

test('the issue sidebar starts closed, and its open state and width are shared by the whole app and restored on reopening', async context => {
  const directory = await testDirectory(context, 'issue-sidebar-persistence');
  let workbench = await Workbench.open(directory);
  try {
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 380 });
    await workbench.saveIssueSidebar({ visible: true, width: 420 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 420 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: true, width: 212 }, 'project navigation keeps its own preferences');
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 420 });
  } finally { await workbench.quit(); }
});

test('the issue sidebar width stays within 300–560px and an invalid request keeps the saved preferences', async context => {
  const directory = await testDirectory(context, 'issue-sidebar-validation');
  const workbench = await Workbench.open(directory);
  try {
    await workbench.saveIssueSidebar({ visible: true, width: 10000 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 560 });
    await workbench.saveIssueSidebar({ visible: false, width: 0 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 300 });
    await assert.rejects(workbench.saveIssueSidebar({ visible: true, width: NaN }), /issueSidebarInvalid/);
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 300 });
  } finally { await workbench.quit(); }
});

test('unreadable stored issue sidebar preferences fail opening and leave the file untouched', async context => {
  const directory = await testDirectory(context, 'issue-sidebar-invalid');
  const workbench = await Workbench.open(directory);
  await workbench.saveIssueSidebar({ visible: true, width: 400 });
  await workbench.quit();
  const db = new DatabaseSync(`${directory}/projects.sqlite`);
  db.prepare('UPDATE issue_sidebar SET preferences=?').run('{"visible":"yes","width":400}');
  db.close();
  await assert.rejects(Workbench.open(directory), /issue_sidebar/);
  const reread = new DatabaseSync(`${directory}/projects.sqlite`);
  assert.equal((reread.prepare('SELECT preferences FROM issue_sidebar').get() as { preferences: string }).preferences, '{"visible":"yes","width":400}');
  reread.close();
});
