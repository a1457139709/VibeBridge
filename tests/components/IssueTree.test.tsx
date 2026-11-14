import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { bug, issue, page, renderWorkbench, rows, sidebar, stubSidebarApis, summary } from './support/forge-lists';
import { githubCapabilities } from './support/forge';

afterEach(cleanup);
before(stubSidebarApis);

/** #10 has the closed sub-issue #11 and the open #12 and #13; #12 is also on the page, and #14's parent is not. */
const tree = () => page([
  issue(14, { parent: 50 }),
  issue(12, { parent: 10 }),
  issue(10, { subIssues: { closed: 1, total: 3, issues: [summary(12), summary(11, { state: 'closed', closedAs: 'completed' }), summary(13, { labels: [bug] })] } }),
]);

test('parents start collapsed behind a progress button that expands their sub-issues in number order, with closed ones folded', async () => {
  const { user, request, requests } = renderWorkbench();
  (await request(1)).answer(tree());
  await waitFor(() => assert.deepEqual(rows(), ['Issue 14', 'Issue 10'], 'only issues without a parent on the page are at the top'));
  const expand = within(sidebar()).getByRole('button', { name: 'Show sub-issues' });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.match(expand.textContent!, /▸.*1\/3/);
  await user.click(expand);
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13']);
  const children = within(sidebar()).getByRole('group', { name: 'Sub-issues of #10' });
  assert.ok(within(children).getByText('bug'), 'a sub-issue keeps its whole row');
  assert.equal(within(children).getAllByRole('listitem').filter(row => row.querySelector('.forge-row-action')).length, 2);
  await user.click(within(children).getByRole('button', { name: '1 closed' }));
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13', 'Issue 11'], 'shown closed sub-issues follow the open ones');
  assert.equal(within(children).getAllByRole('listitem').filter(row => row.querySelector('.forge-row-action')).length, 2, 'a closed issue has no action area');
  await user.click(within(children).getByRole('button', { name: 'Hide closed' }));
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13']);
  const collapse = within(sidebar()).getByRole('button', { name: 'Hide sub-issues' });
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.match(collapse.textContent!, /▾/);
  await user.click(collapse);
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10']);
  assert.equal(requests.length, 1, 'expanding fetches nothing');
});

test('a blocked issue shows the blockers\' numbers, names them on hover, and keeps its action area', async () => {
  const { request } = renderWorkbench();
  (await request(1)).answer(page([issue(9, { blockedBy: [{ path: null, number: 143, title: 'Sidebar shell' }, { path: 'octo/other', number: 7, title: 'Upstream fix' }] }), issue(8)]));
  const mark = await within(sidebar()).findByLabelText('Blocked by #143, octo/other#7');
  assert.equal(mark.textContent, '#143, octo/other#7');
  assert.equal(mark.getAttribute('data-hint'), '#143 Sidebar shell\nocto/other#7 Upstream fix');
  const [blocked, free] = within(sidebar()).getAllByRole('listitem');
  assert.ok(blocked.contains(mark));
  assert.ok(blocked.querySelector('.forge-row-action'), 'a blocked issue can still be dispatched');
  assert.equal(within(free).queryByLabelText(/^Blocked by/), null);
});

test('an issue blocked by more open issues than the forge listed counts the rest', async () => {
  const { request } = renderWorkbench();
  (await request(1)).answer(page([issue(9, { blockedBy: [{ path: null, number: 143, title: 'Sidebar shell' }], unlistedBlockers: 2 }),
    issue(8, { unlistedBlockers: 1 })]));
  const mark = await within(sidebar()).findByLabelText('Blocked by #143, +2 more');
  assert.equal(mark.getAttribute('data-hint'), '#143 Sidebar shell\n+2 more');
  assert.ok(within(sidebar()).getByLabelText('Blocked by +1 more'), 'an issue none of whose open blockers is listed is still marked');
});

test('a parent shows the progress button only when the list holds sub-issues to show', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([
    issue(30, { subIssues: { closed: 0, total: 4, issues: [] } }),
    issue(21, { parent: 20 }),
    issue(20, { subIssues: { closed: 0, total: 0, issues: [] } }),
  ]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 30', 'Issue 20']));
  const buttons = within(sidebar()).getAllByRole('button', { name: 'Show sub-issues' });
  assert.equal(buttons.length, 1, 'a parent whose sub-issues are all outside the list has no button');
  await user.click(buttons[0]);
  assert.deepEqual(rows(), ['Issue 30', 'Issue 20', 'Issue 21'], 'a loaded sub-issue stays reachable under its parent');
});

for (const capabilities of [{ subIssues: false, blocking: false }, { subIssues: true, blocking: false }, { subIssues: false, blocking: true }]) {
  test(`a forge declaring sub-issues ${capabilities.subIssues} and blocking ${capabilities.blocking} shows only what it declares`, async () => {
    const { request } = renderWorkbench({ ...githubCapabilities, ...capabilities });
    const answer = tree();
    assert.ok(answer.ok);
    answer.items[0].blockedBy = [{ path: null, number: 1, title: 'Blocker' }];
    (await request(1)).answer(answer);
    await within(sidebar()).findByText('Issue 14');
    assert.deepEqual(rows(), capabilities.subIssues ? ['Issue 14', 'Issue 10'] : ['Issue 14', 'Issue 12', 'Issue 10']);
    assert.equal(!!within(sidebar()).queryByRole('button', { name: 'Show sub-issues' }), capabilities.subIssues);
    assert.equal(!!within(sidebar()).queryByLabelText('Blocked by #1'), capabilities.blocking);
  });
}

test('listing closed issues, an expanded parent shows its closed sub-issues and folds nothing', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(tree());
  await user.click(await within(sidebar()).findByRole('button', { name: 'Closed 2' }));
  (await request(2)).answer(page([issue(10, { state: 'closed', closedAs: 'completed',
    subIssues: { closed: 1, total: 3, issues: [summary(12), summary(13, { state: 'closed', closedAs: 'completed' }), summary(11)] } })]));
  await user.click(await within(sidebar()).findByRole('button', { name: 'Show sub-issues' }));
  assert.deepEqual(rows(), ['Issue 10', 'Issue 13']);
  assert.equal(within(sidebar()).queryByRole('button', { name: /closed$/ }), null);
});

test('an issue whose parent arrives with Load more moves under it', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(12, { parent: 10 })], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 12']));
  await user.click(within(sidebar()).getByRole('button', { name: 'Load more' }));
  (await request(2)).answer(page([issue(10, { subIssues: { closed: 0, total: 1, issues: [summary(12)] } })]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 10']));
});
