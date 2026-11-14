import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { stubSidebarApis, sidebar } from './support/forge-lists';
import { issueDetail, listed, menu, record, row } from './support/dispatch';

afterEach(cleanup);
before(stubSidebarApis);

/** Presses a key with ⌘ where focus is; true when nothing took it, so it goes on to where focus is. */
const pressCommandKey = (code: 'KeyD' | 'KeyL') => fireEvent.keyDown(document.activeElement!, { key: code.at(-1)!.toLowerCase(), code, metaKey: true });
/** The open detail, once it shows the issue. */
async function detailOf(number: number) {
  const detail = await waitFor(() => document.querySelector<HTMLElement>('.forge-detail')!);
  await within(detail).findByRole('heading', { name: `Issue ${number} #${number}` });
  return detail;
}

test('⌘D opens the dispatch menu of the issue focused in the list, or the detail\'s own of the issue it shows, and is left alone elsewhere', async () => {
  const f = await listed();
  window.workbench.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  within(row(9)).getByRole('button', { name: 'Issue 9' }).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(row(9).contains(menu()), 'the menu opens on the row');
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  within(row(8)).getByRole('button', { name: 'Issue 8' }).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'a closed issue is not dispatched');
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  const detail = await detailOf(9);
  within(detail).getByRole('button', { name: 'Close' }).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(detail.contains(menu()), 'the menu opens in the detail');
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  screen.getByRole('button', { name: 'Add Agent' }).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'outside the sidebar the key goes to the terminal');
});

test('from a detail whose list row is not showing, ⌘D opens the detail\'s dispatch menu, a submit returns focus to its Dispatch, and ⌘L locates', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' })];
  });
  window.workbench.issueDetail = async (_, number) => ({ ok: true, issue: issueDetail(number) });
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  const detail = await detailOf(9);
  await f.user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  within(detail).getByRole('button', { name: 'Close' }).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu()));
  assert.ok(detail.contains(menu()));
  await f.user.keyboard('{ArrowLeft} ');
  await waitFor(() => assert.equal(f.dispatches.length, 1));
  await waitFor(() => assert.equal(document.activeElement, within(detail).getByRole('button', { name: 'Dispatch' })));
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('⌘L locates the dispatched panel of a closed issue', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(8, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' })];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  within(row(8)).getByRole('button', { name: 'Issue 8' }).focus();
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test('⌘L locates the panel of the focused issue\'s latest dispatch a panel is on', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' }), record(9, null)];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  screen.getByRole('button', { name: 'Add Agent' }).focus();
  assert.equal(pressCommandKey('KeyL'), true, 'outside the sidebar the key goes to the terminal');
  within(row(9)).getByRole('button', { name: 'Issue 9' }).focus();
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});
