import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';

test('the issue sidebar starts closed and its open state and width are restored on reopening, outside user settings', async context => {
  const directory = await testDirectory(context, 'issue-sidebar-persistence');
  let workbench = await Workbench.open(directory);
  try {
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 380 });
    await workbench.saveIssueSidebar({ visible: true, width: 420 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 420 });
    await workbench.saveNavigation({ visible: false, width: 300 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 420 });
    await workbench.quit();
    const settings = JSON.parse(await readFile(`${directory}/settings.json`, 'utf8'));
    assert.equal('issueSidebar' in settings, false);
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 420 });
    assert.deepEqual(workbench.snapshot().navigation, { visible: false, width: 300 });
  } finally { await workbench.quit(); }
});

test('issue sidebar widths are kept between 300 and 560 px and invalid requests do not replace the saved state', async context => {
  const directory = await testDirectory(context, 'issue-sidebar-validation');
  const workbench = await Workbench.open(directory);
  try {
    await workbench.saveIssueSidebar({ visible: true, width: 10000 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: true, width: 560 });
    await workbench.saveIssueSidebar({ visible: false, width: 0 });
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 300 });
    await assert.rejects(workbench.saveIssueSidebar({ visible: true, width: NaN }), /issueSidebarInvalid/);
    await assert.rejects(workbench.saveIssueSidebar({ visible: true } as never), /issueSidebarInvalid/);
    assert.deepEqual(workbench.snapshot().issueSidebar, { visible: false, width: 300 });
  } finally { await workbench.quit(); }
});
