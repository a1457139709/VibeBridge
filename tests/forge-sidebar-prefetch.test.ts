import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble } from './support/gh-double';
import { boundWorkbench, day, forgeAccount, issueDetail } from './support/bound-workbench';
import { byNumber, detail, detailTitle, forge, issue, shownIssues, sidebarData } from './support/sidebar-data-sources';
import { lastOf } from './support/expected';

// A row the pointer or keyboard focus rests on is likely opened next: after 150ms its detail is read into the kept
// details, so opening it shows at once.

const three = { kind: 'issue', number: 3 } as const;

test('a detail is read once the pointer or focus rested 150ms on its row; leaving sooner reads nothing', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads } = sidebar;
  await shownIssues(sidebar, [3, 2]);
  const before = reads.length;
  void data.reportRestingOn('alpha', three);
  context.mock.timers.tick(149);
  void data.reportRestingOn('alpha', { kind: 'issue', number: 2 });
  context.mock.timers.tick(149);
  void data.reportRestingOn('alpha', null);
  context.mock.timers.tick(1000);
  assert.equal(reads.length, before, 'a row left before 150ms is not read');
  const rested = data.reportRestingOn('alpha', three);
  context.mock.timers.tick(150);
  assert.deepEqual(
    reads.slice(before).map(read => read.item),
    [three],
    'the row rested on for 150ms is read',
  );
  lastOf(reads).answer(detail(3));
  await rested;
});

test('a detail read ahead opens at once without asking the forge again', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads, shownDetail } = sidebar;
  await shownIssues(sidebar, [3]);
  const rested = data.reportRestingOn('alpha', three);
  context.mock.timers.tick(150);
  lastOf(reads).answer(detail(3, 'Read ahead'));
  await rested;
  const before = reads.length;
  await data.showDetail('alpha', three);
  assert.equal(reads.length, before, 'opening asks nothing');
  assert.equal(detailTitle(shownDetail()), 'Read ahead');
});

test('a kept detail is not read ahead, and opening one still on its way waits for that read', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads, shownDetail } = sidebar;
  await shownIssues(sidebar, [3, 2]);
  const opened = data.showDetail('alpha', three);
  lastOf(reads).answer(detail(3));
  await opened;
  await data.showDetail('alpha', null);
  const before = reads.length;
  const restedOnKept = data.reportRestingOn('alpha', three);
  context.mock.timers.tick(150);
  await restedOnKept;
  assert.equal(reads.length, before, 'a kept detail is not read ahead');

  const two = { kind: 'issue', number: 2 } as const;
  const rested = data.reportRestingOn('alpha', two);
  context.mock.timers.tick(150);
  const openedTwo = data.showDetail('alpha', two);
  assert.deepEqual(
    reads.slice(before).map(read => read.item),
    [two],
    'opening the item read ahead asks the forge no second time',
  );
  lastOf(reads).answer(detail(2, 'Answered once'));
  await Promise.all([rested, openedTwo]);
  assert.equal(detailTitle(shownDetail()), 'Answered once');
});

test('a read ahead that fails shows nothing; opening the item then asks the forge and shows its answer', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads, events, shownDetail } = sidebar;
  await shownIssues(sidebar, [3]);
  const count = events.length;
  const rested = data.reportRestingOn('alpha', three);
  context.mock.timers.tick(150);
  lastOf(reads).fail(new Error('gh exited'));
  await rested;
  assert.deepEqual(events.slice(count), [], 'nothing is pushed');
  const before = reads.length;
  const opened = data.showDetail('alpha', three);
  assert.deepEqual(reads[before]?.item, three, 'opening asks the forge');
  reads[before].fail(new Error('gh exited again'));
  await opened;
  assert.deepEqual(shownDetail()?.result, {
    ok: false,
    failure: { kind: 'transient', detail: 'gh exited again', forge },
  });
});

test('an issue read ahead opens without a gh call', async context => {
  const double = await ghDouble(context, {
    ...forgeAccount,
    issues: [{ number: 3, title: 'Read ahead', state: 'OPEN', createdAt: day(3), labels: [] }],
  });
  const f = await boundWorkbench('detail-read-ahead');
  try {
    const sidebar = f.workbench.forgeSidebar;
    await sidebar.reportPresence({ visible: true, foreground: true, projectId: f.projectId });
    await double.calls();
    context.mock.timers.enable({ apis: ['setTimeout'] });
    const rested = sidebar.reportRestingOn(f.projectId, three);
    context.mock.timers.tick(150);
    context.mock.timers.reset();
    await rested;
    assert.equal((await double.calls()).length, 1, 'the rest reads the issue');
    const shown = await issueDetail(f.workbench, f.projectId, 3);
    assert.deepEqual([shown.ok && shown.issue.title, await double.calls()], ['Read ahead', []]);
  } finally {
    await f.close();
  }
});

test('nothing is read ahead while the sidebar is hidden or its window is behind', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads } = sidebar;
  await shownIssues(sidebar, [3]);
  const before = reads.length;
  for (const presence of [
    { visible: true, foreground: false, projectId: 'alpha' },
    { visible: false, foreground: true, projectId: 'alpha' },
  ]) {
    await data.reportPresence(presence);
    const rested = data.reportRestingOn('alpha', three);
    context.mock.timers.tick(150);
    await rested;
  }
  assert.equal(reads.length, before);
});

test('a read ahead on its way when a direct action changes its item is not kept: opening the item asks the forge again', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sidebar = sidebarData();
  const { data, reads, shownDetail } = sidebar;
  await shownIssues(sidebar, [3]);
  const rested = data.reportRestingOn('alpha', three);
  context.mock.timers.tick(150);
  const readAhead = lastOf(reads);
  const changed = data.reloadChanged('alpha', three);
  lastOf(reads).answer(byNumber([issue(3)]));
  await changed;
  readAhead.answer(detail(3, 'Before the change'));
  await rested;
  const before = reads.length;
  const opened = data.showDetail('alpha', three);
  assert.equal(detailTitle(shownDetail()), undefined, 'the answer from before the change does not show');
  assert.deepEqual(reads[before]?.item, three, 'opening asks the forge');
  reads[before].answer(detail(3, 'After the change'));
  await opened;
  assert.equal(detailTitle(shownDetail()), 'After the change');
});
