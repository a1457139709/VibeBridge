import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { stubSidebarApis, sidebar } from './support/forge-lists';
import { listed, menu, record, row } from './support/dispatch';

afterEach(cleanup);
before(stubSidebarApis);

/** Presses a key with ⌘ where focus is; true when nothing took it, so it goes on to where focus is. */
const pressCommandKey = (code: 'KeyD' | 'KeyL') => fireEvent.keyDown(document.activeElement!, { key: code.at(-1)!.toLowerCase(), code, metaKey: true });

test('⌘D opens the dispatch menu of the issue focused in the list or shown in the detail, and is left alone elsewhere', async () => {
  const f = await listed();
  within(row(9)).getByRole('button', { name: 'Issue 9' }).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  assert.equal(document.activeElement, menu());
  await f.user.keyboard('{Escape}');
  within(row(8)).getByRole('button', { name: 'Issue 8' }).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'a closed issue is not dispatched');
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  const detail = await waitFor(() => document.querySelector<HTMLElement>('.forge-detail')!);
  within(detail).getByRole('button', { name: 'Close' }).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  assert.ok(menu());
  await f.user.keyboard('{Escape}');
  screen.getByRole('button', { name: 'Add Agent' }).focus();
  assert.equal(pressCommandKey('KeyD'), true, 'outside the sidebar the key goes to the terminal');
  assert.equal(screen.queryByRole('menu'), null);
});

test('from a detail whose list row is not showing, ⌘D is left alone and ⌘L still locates', async () => {
  const f = await listed(undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(9, { projectId: 'beta', panelId: 'beta-panel', status: 'ready' })];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => { activated.push(id); f.snapshot.activeProjectId = id; f.publish(); };
  await f.user.click(within(row(9)).getByRole('button', { name: 'Issue 9' }));
  const detail = await waitFor(() => document.querySelector<HTMLElement>('.forge-detail')!);
  await f.user.click(within(sidebar()).getByRole('tab', { name: 'Pull requests' }));
  within(detail).getByRole('button', { name: 'Close' }).focus();
  assert.equal(pressCommandKey('KeyD'), true);
  assert.equal(screen.queryByRole('menu'), null);
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
