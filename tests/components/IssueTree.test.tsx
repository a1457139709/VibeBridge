import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { bug, issue, page, renderWorkbench, rows, stateFilter, stubSidebarApis, summary } from './support/forge-lists';
import { overrideCapabilities, testForgeCapabilities, testForge, testForgeUrl } from './support/forge';
import { t } from './support/localization';
import { forgeSidebar } from './support/sidebar-queries';

afterEach(cleanup);
before(stubSidebarApis);

const tree = () =>
  page([
    issue(14, { parent: 50 }),
    issue(12, { parent: 10 }),
    issue(10, {
      subIssues: {
        closed: 1,
        total: 3,
        unlisted: 0,
        issues: [summary(12), summary(11, { state: 'closed', closedAs: 'completed' }), summary(13, { labels: [bug] })],
      },
    }),
  ]);

test('parents start collapsed behind a progress button that expands their sub-issues in number order, with closed ones folded', async () => {
  const { user, request, requests } = renderWorkbench();
  (await request(1)).answer(tree());
  await waitFor(() =>
    assert.deepEqual(rows(), ['Issue 14', 'Issue 10'], 'only issues without a parent on the page are at the top'),
  );
  const expand = within(forgeSidebar()).getByRole('button', { name: t('showSubIssues') });
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.match(expand.textContent ?? '', /▸.*1\/3/);
  await user.click(expand);
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13']);
  const children = within(forgeSidebar()).getByRole('group', { name: t('subIssuesOf', { number: 10 }) });
  assert.ok(within(children).getByRole('button', { name: bug.name }), 'a sub-issue keeps its whole row');
  assert.equal(
    within(children)
      .getAllByRole('listitem')
      .filter(row => row.querySelector('.forge-row-action')).length,
    2,
  );
  await user.click(within(children).getByRole('button', { name: t('closedSubIssues', { count: 1 }) }));
  assert.deepEqual(
    rows(),
    ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13', 'Issue 11'],
    'shown closed sub-issues follow the open ones',
  );
  assert.equal(
    within(children)
      .getAllByRole('listitem')
      .filter(row => row.querySelector('.forge-row-action')).length,
    2,
    'a closed issue has no action area',
  );
  await user.click(within(children).getByRole('button', { name: t('hideClosedSubIssues') }));
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10', 'Issue 12', 'Issue 13']);
  const collapse = within(forgeSidebar()).getByRole('button', { name: t('hideSubIssues') });
  assert.equal(collapse.getAttribute('aria-expanded'), 'true');
  assert.match(collapse.textContent ?? '', /▾/);
  await user.click(collapse);
  assert.deepEqual(rows(), ['Issue 14', 'Issue 10']);
  assert.equal(requests.length, 1, 'expanding fetches nothing');
});

test("a blocked issue shows the blockers' numbers, names them on hover, and keeps its action area", async () => {
  const { request } = renderWorkbench();
  (await request(1)).answer(
    page([
      issue(9, {
        blockedBy: [
          { path: null, number: 143, title: 'Sidebar shell' },
          { path: 'ada/other', number: 7, title: 'Upstream fix' },
        ],
      }),
      issue(8),
    ]),
  );
  const mark = await within(forgeSidebar()).findByRole('img', {
    name: t('blockedBy', { issues: '#143, ada/other#7' }),
  });
  assert.equal(mark.textContent, '#143, ada/other#7');
  assert.equal(mark.getAttribute('data-hint'), '#143 Sidebar shell\nada/other#7 Upstream fix');
  const [blocked, free] = within(forgeSidebar()).getAllByRole('listitem');
  assert.ok(blocked.contains(mark));
  assert.ok(blocked.querySelector('.forge-row-action'), 'a blocked issue can still be dispatched');
  assert.equal(free.querySelector('.forge-blocked'), null);
});

test('an issue blocked by more open issues than the forge listed counts the rest', async () => {
  const { request } = renderWorkbench();
  (await request(1)).answer(
    page([
      issue(9, { blockedBy: [{ path: null, number: 143, title: 'Sidebar shell' }], unlistedBlockers: 2 }),
      issue(8, { unlistedBlockers: 1 }),
    ]),
  );
  const twoMore = t('moreBlockers', { count: 2 });
  const mark = await within(forgeSidebar()).findByRole('img', { name: t('blockedBy', { issues: `#143, ${twoMore}` }) });
  assert.equal(mark.getAttribute('data-hint'), `#143 Sidebar shell\n${twoMore}`);
  assert.ok(
    within(forgeSidebar()).getByRole('img', { name: t('blockedBy', { issues: t('moreBlockers', { count: 1 }) }) }),
    'an issue none of whose open blockers is listed is still marked',
  );
});

test('an expanded parent whose sub-issues the forge cut short says how many more and links the issue on the forge', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(
    page([
      issue(10, {
        subIssues: {
          closed: 0,
          total: 55,
          unlisted: 5,
          issues: Array.from({ length: 50 }, (_, index) => summary(100 + index)),
        },
      }),
      issue(200, { parent: 10 }),
      issue(9, { subIssues: { closed: 0, total: 3, unlisted: 0, issues: [summary(5)] } }),
    ]),
  );
  for (const expand of await within(forgeSidebar()).findAllByRole('button', { name: t('showSubIssues') }))
    await user.click(expand);
  const more = within(within(forgeSidebar()).getByRole('group', { name: t('subIssuesOf', { number: 10 }) })).getByRole(
    'link',
    { name: t('moreSubIssues', { count: 4, forge: testForge.name }) },
  );
  assert.equal(
    more.getAttribute('href'),
    `${testForgeUrl}/ada/alpha/issues/10`,
    'a sub-issue the cap left out but the list loaded is not counted again',
  );
  assert.equal(
    within(within(forgeSidebar()).getByRole('group', { name: t('subIssuesOf', { number: 9 }) })).queryByRole('link'),
    null,
    'sub-issues of another repository that the list cannot show are not counted as left out',
  );
});

test('a parent shows the progress button only when the list holds sub-issues to show', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(
    page([
      issue(30, { subIssues: { closed: 0, total: 4, unlisted: 0, issues: [] } }),
      issue(21, { parent: 20 }),
      issue(20, { subIssues: { closed: 0, total: 0, unlisted: 0, issues: [] } }),
    ]),
  );
  await waitFor(() => assert.deepEqual(rows(), ['Issue 30', 'Issue 20']));
  const buttons = within(forgeSidebar()).getAllByRole('button', { name: t('showSubIssues') });
  assert.equal(buttons.length, 1, 'a parent whose sub-issues are all outside the list has no button');
  await user.click(buttons[0]);
  assert.deepEqual(rows(), ['Issue 30', 'Issue 20', 'Issue 21'], 'a loaded sub-issue stays reachable under its parent');
});

for (const capabilities of [
  { subIssues: false, blocking: false },
  { subIssues: true, blocking: false },
  { subIssues: false, blocking: true },
]) {
  test(`a forge declaring sub-issues ${capabilities.subIssues} and blocking ${capabilities.blocking} shows only what it declares`, async () => {
    const { request } = renderWorkbench(overrideCapabilities(capabilities));
    const answer = tree();
    assert.ok(answer.ok);
    answer.items[0].blockedBy = [{ path: null, number: 1, title: 'Blocker' }];
    (await request(1)).answer(answer);
    await waitFor(() => assert.ok(rows().includes('Issue 14')));
    assert.deepEqual(rows(), capabilities.subIssues ? ['Issue 14', 'Issue 10'] : ['Issue 14', 'Issue 12', 'Issue 10']);
    assert.equal(!!within(forgeSidebar()).queryByRole('button', { name: t('showSubIssues') }), capabilities.subIssues);
    assert.equal(
      !!within(forgeSidebar()).queryByRole('img', { name: t('subIssueProgress', { closed: 1, total: 3 }) }),
      capabilities.subIssues,
    );
    assert.equal(
      !!within(forgeSidebar()).queryByRole('img', { name: t('blockedBy', { issues: '#1' }) }),
      capabilities.blocking,
    );
  });
}

test('listing closed issues, an expanded parent shows its closed sub-issues and folds nothing', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(tree());
  await user.click(await waitFor(() => stateFilter('closed', 2)));
  (await request(2)).answer(
    page([
      issue(10, {
        state: 'closed',
        closedAs: 'completed',
        subIssues: {
          closed: 1,
          total: 3,
          unlisted: 0,
          issues: [summary(12), summary(13, { state: 'closed', closedAs: 'completed' }), summary(11)],
        },
      }),
    ]),
  );
  await user.click(await within(forgeSidebar()).findByRole('button', { name: t('showSubIssues') }));
  assert.deepEqual(rows(), ['Issue 10', 'Issue 13']);
  assert.equal(forgeSidebar().querySelector('button.forge-fold'), null, 'no closed sub-issues are folded');
});

test('an issue whose parent arrives with Load more moves under it', async () => {
  const { user, request } = renderWorkbench();
  (await request(1)).answer(page([issue(12, { parent: 10 })], 'next'));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 12']));
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('loadMore') }));
  (await request(2)).answer(
    page([issue(10, { subIssues: { closed: 0, total: 1, unlisted: 0, issues: [summary(12)] } })]),
  );
  await waitFor(() => assert.deepEqual(rows(), ['Issue 10']));
});
