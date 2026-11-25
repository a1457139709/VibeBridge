import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { stubSidebarApis, summary } from './support/forge-lists';
import { issueButton, issueDetail, listed, menu, record, row } from './support/dispatch';
import { t } from './support/localization';
import { requireValue } from '../../app/renderer/common/required';
import { focusedElement } from './support/elements';
import { forgeSidebar, detailHeading } from './support/sidebar-queries';

afterEach(cleanup);
before(stubSidebarApis);

const pressCommandKey = (code: 'KeyD' | 'KeyL') =>
  fireEvent.keyDown(focusedElement(), {
    key: requireValue(code.at(-1), 'the key code').toLowerCase(),
    code,
    metaKey: true,
  });
async function detailOf(number: number) {
  const detail = await within(forgeSidebar()).findByRole('region', { name: t('issueDetail') });
  await detailHeading(detail, summary(number).title, number);
  return detail;
}

test("⌘D opens the dispatch menu of the issue focused in the list, or the detail's own of the issue it shows, and is left alone elsewhere", async () => {
  const f = await listed();
  f.forge.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  issueButton(9).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(row(9).contains(menu()), 'the menu opens on the row');
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  issueButton(8).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'a closed issue is not dispatched');
  await f.user.click(issueButton(9));
  const detail = await detailOf(9);
  within(detail)
    .getByRole('button', { name: t('closeDetail') })
    .focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(detail.contains(menu()), 'the menu opens in the detail');
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  screen.getByRole('button', { name: t('addPanel') }).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'outside the sidebar the key goes to the terminal');
});

test("from a detail whose list row is not showing, ⌘D opens the detail's dispatch menu, a submit returns focus to its Dispatch, and ⌘L locates", async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel' })];
  });
  f.forge.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  await f.user.click(issueButton(9));
  const detail = await detailOf(9);
  await f.user.click(within(forgeSidebar()).getByRole('tab', { name: t('pullRequestsTab') }));
  within(detail)
    .getByRole('button', { name: t('closeDetail') })
    .focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(detail.contains(menu()));
  await f.user.keyboard('{ArrowLeft} ');
  await waitFor(() => assert.equal(f.dispatches.length, 1));
  await waitFor(() =>
    assert.equal(document.activeElement, within(detail).getByRole('button', { name: t('dispatch') })),
  );
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('⌘L locates the dispatched panel of a closed issue', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(8, { projectId: 'beta', panelId: 'beta-panel' })];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  issueButton(8).focus();
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test("⌘L locates the panel of the focused issue's latest dispatch a panel is on", async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel' }), record(9, null)];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  screen.getByRole('button', { name: t('addPanel') }).focus();
  assert.equal(pressCommandKey('KeyL'), true, 'outside the sidebar the key goes to the terminal');
  issueButton(9).focus();
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});
