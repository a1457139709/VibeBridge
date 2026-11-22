import './support/dom';
import { localize } from '../../app/shared/localization/localization';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { act, cleanup, waitFor, within } from '@testing-library/react';
import type { DetailItem } from '../../app/shared/forge/sidebar-data';
import {
  issue,
  page,
  pullRequest,
  refresh,
  renderWorkbench,
  rows,
  sidebar,
  stubSidebarApis,
} from './support/forge-lists';

const { t } = localize('en');

afterEach(cleanup);
before(stubSidebarApis);

async function restingRows() {
  const reported: (DetailItem | null)[] = [];
  const rendered = renderWorkbench(undefined, {
    reportForgeRowResting: async (projectId, item) => {
      assert.equal(projectId, 'alpha');
      reported.push(item);
    },
  });
  (await rendered.request(1)).answer(page([issue(9), issue(8)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 9', 'Issue 8']));
  return { ...rendered, reported };
}
const titleOf = (name: string) => within(sidebar()).getByRole('button', { name });

test('the pointer resting on a row reports its item once, moving to another reports that one, and leaving the rows reports none', async () => {
  const { user, reported } = await restingRows();
  await user.hover(titleOf('Issue 9'));
  await user.hover(within(sidebar()).getByText('#9'));
  await user.hover(titleOf('Issue 8'));
  await user.unhover(titleOf('Issue 8'));
  await user.hover(within(sidebar()).getByRole('tab', { name: t('issuesTab') }));
  assert.deepEqual(reported, [{ kind: 'issue', number: 9 }, { kind: 'issue', number: 8 }, null]);
});

test('keyboard focus on a row reports its item, and focus leaving the rows reports none', async () => {
  const { user, reported } = await restingRows();
  titleOf('Issue 9').focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => assert.equal(document.activeElement, titleOf('Issue 8')));
  within(sidebar())
    .getByRole('tab', { name: t('issuesTab') })
    .focus();
  assert.deepEqual(reported, [{ kind: 'issue', number: 9 }, { kind: 'issue', number: 8 }, null]);
});

test('a rested row that unmounts, as a refresh drops it, reports none', async () => {
  const { user, reported, request } = await restingRows();
  await user.hover(titleOf('Issue 9'));
  act(() => refresh().click());
  (await request(2)).answer(page([issue(8)]));
  await waitFor(() => assert.deepEqual(rows(), ['Issue 8']));
  await waitFor(() => assert.deepEqual(reported, [{ kind: 'issue', number: 9 }, null]));
});

test('a pull request row reports its item', async () => {
  const { user, reported, request } = await restingRows();
  await user.click(within(sidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  (await request(2)).answer(page([pullRequest(4)]));
  await waitFor(() => assert.deepEqual(rows(), ['Change 4']));
  await user.hover(titleOf('Change 4'));
  assert.deepEqual(reported.at(-1), { kind: 'pullRequest', number: 4 });
});
