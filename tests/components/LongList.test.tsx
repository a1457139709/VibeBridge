import './support/dom';
import { t } from './support/localization';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import {
  issue,
  listGeometry,
  openNoFilter,
  page,
  refresh,
  renderWorkbench,
  rows,
  sidebar,
  stubSidebarApis,
} from './support/forge-lists';
import { selectElement } from './support/elements';

const shownGeometry = { ...listGeometry };
afterEach(() => {
  cleanup();
  Object.assign(listGeometry, shownGeometry);
});
before(stubSidebarApis);

const issues = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => issue(from + index));
const titles = (numbers: number[]) => numbers.map(number => `Issue ${number}`);
const scrollArea = () => selectElement('.forge-scroll', sidebar());
const scrollTo = (scrollTop: number) => {
  scrollArea().scrollTop = scrollTop;
  fireEvent.scroll(scrollArea());
};
const renderedNumbers = () =>
  [...sidebar().querySelectorAll<HTMLElement>('[data-issue]')].map(row => Number(row.dataset.issue));

async function scrolledLongList() {
  Object.assign(listGeometry, { viewport: 200, row: 40 });
  const workbench = renderWorkbench();
  (await workbench.request(1)).answer(page(issues(1, 10), 'p2'));
  await waitFor(() => assert.ok(rows().includes('Issue 1')));
  await workbench.user.click(within(sidebar()).getByRole('button', { name: t('loadMore') }));
  (await workbench.request(2)).answer(page(issues(11, 20)));
  await waitFor(() => assert.ok(!refresh().hasAttribute('disabled')));
  scrollTo(12 * 40 + 20);
  await waitFor(() => assert.ok(rows().includes('Issue 13') && !rows().includes('Issue 1')));
  return workbench;
}

test('a long list renders only the rows in view and around them, and declares those rows to the main process', async () => {
  const { shownRows } = await scrolledLongList();
  for (const shown of titles([13, 14, 15, 16, 17])) assert.ok(rows().includes(shown), `${shown} is in view`);
  assert.ok(!rows().includes('Issue 1'), 'a row far above the view does not render');
  assert.equal(scrollArea().scrollTop, 500, 'the rows not rendered keep their space');
  await waitFor(() => assert.deepEqual(shownRows.at(-1), renderedNumbers()));
});

test('Refresh reloads through the page in view and returns to the issue at the top of the view', async () => {
  const { user, request } = await scrolledLongList();
  await user.click(refresh());
  const first = await request(3);
  assert.deepEqual(first.query, { filter: openNoFilter, cursor: null });
  first.answer(page([issue(21), ...issues(1, 9)], 'p2'));
  const second = await request(4);
  assert.deepEqual(second.query, { filter: openNoFilter, cursor: 'p2' });
  second.answer(page(issues(10, 20)));
  await waitFor(() =>
    assert.equal(scrollArea().scrollTop, 13 * 40 + 20, 'issue 13 moved down one row, and the view with it'),
  );
  assert.ok(rows().includes('Issue 13'));
});

test('Refresh returns to the old place in the list when the issue at the top of the view is gone', async () => {
  const { user, request } = await scrolledLongList();
  await user.click(refresh());
  (await request(3)).answer(page([issue(21), issue(22), ...issues(1, 8)], 'p2'));
  (await request(4)).answer(page(issues(9, 20).filter(item => item.number !== 13)));
  await waitFor(() => assert.ok(!refresh().hasAttribute('disabled') && !rows().includes('Issue 13')));
  assert.equal(scrollArea().scrollTop, 12 * 40 + 20, 'the view stays at the thirteenth row, now issue 11');
  assert.ok(rows().includes('Issue 11'));
});

test("closing the detail returns focus to its issue's row, scrolling back to it when it went out of view", async () => {
  const { user } = await scrolledLongList();
  await user.click(within(sidebar()).getByRole('button', { name: issue(13).title }));
  const detail = await waitFor(() => selectElement('.forge-detail'));
  scrollTo(0);
  await waitFor(() => assert.ok(!rows().includes('Issue 13')));
  await user.click(within(detail).getByRole('button', { name: t('closeDetail') }));
  await waitFor(() => assert.equal(document.activeElement?.textContent, 'Issue 13'));
  assert.ok(document.activeElement?.matches('.forge-row-title'));
});
