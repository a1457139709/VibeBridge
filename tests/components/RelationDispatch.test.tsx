import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { IssueDetail, SubIssue } from '../../app/shared/forge/forge';
import { stubSidebarApis } from './support/forge-lists';
import {
  commandNamed,
  issueButton,
  issueDetail,
  listed,
  menu,
  record,
  targetsMenu,
  trayTitle,
} from './support/dispatch';
import { testForgeUrl } from './support/forge';
import { t } from './support/localization';
import { focusedElement } from './support/elements';
import { nameIncluding } from './support/accessible-names';
import { requireValue } from '../../app/renderer/common/required';
import { detailHeading, forgeSidebar } from './support/sidebar-queries';

afterEach(cleanup);
before(stubSidebarApis);

const related = (number: number, extra: Partial<SubIssue> = {}): SubIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  url: `${testForgeUrl}/ada/alpha/issues/${number}`,
  path: null,
  blockedBy: [],
  unlistedBlockers: 0,
  ...extra,
});
const ownSubIssues = [related(10), related(11, { state: 'closed', closedAs: 'completed' })];
const withSubIssues = issueDetail(9, { subIssues: ownSubIssues, subIssueProgress: { closed: 1, total: 2 } });
const withSiblings = issueDetail(9, {
  parent: {
    ...related(1),
    progress: { closed: 0, total: 2 },
    subIssues: [related(9), related(12)],
  },
});

async function opened(issue: IssueDetail, ...rest: Parameters<typeof listed>) {
  const f = await listed(...rest);
  f.forge.issueDetail = async () => ({ ok: true, issue });
  await f.user.click(issueButton(issue.number));
  await detailHeading(pane(), issue.title, issue.number);
  return f;
}
const pane = () => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') });
const list = (name: 'subIssues' | 'siblingIssues') => within(pane()).getByRole('region', { name: t(name) });
const rowButton = (scope: HTMLElement, number: number) =>
  within(scope).getByRole('button', { name: nameIncluding(`Issue ${number}`) });
const pressCommandKey = (code: 'KeyD' | 'KeyL') =>
  fireEvent.keyDown(focusedElement(), {
    key: requireValue(code.at(-1), 'the key code').toLowerCase(),
    code,
    metaKey: true,
  });

test("an open sub-issue row dispatches from its own Dispatch, with the sidebar row's menu, targets and delivery", async () => {
  const f = await opened(withSubIssues);
  const subIssues = list('subIssues');
  const [dispatch, ...others] = within(subIssues).getAllByRole('button', { name: t('dispatch') });
  assert.deepEqual(others, [], 'the closed row has no Dispatch');
  await f.user.click(dispatch);
  await waitFor(() => assert.equal(document.activeElement, menu(10)));
  assert.ok(subIssues.contains(menu(10)), 'the menu opens on the row');
  await f.user.hover(within(menu(10)).getByRole('menuitem', commandNamed('implement', ['submit'])));
  await f.user.click(
    within(await waitFor(() => targetsMenu('implement'))).getByRole('menuitem', { name: nameIncluding(trayTitle) }),
  );
  await waitFor(() =>
    assert.deepEqual(f.dispatches, [
      [
        'alpha',
        {
          issue: { number: 10, title: 'Issue 10' },
          workflowId: 'matt',
          commandId: 'implement',
          target: { kind: 'panel', panelId: 'tray' },
          invertDelivery: false,
        },
      ],
    ]),
  );
});

test('a right click opens the Dispatch menu of an open sub-issue row, and leaves a closed row to the system', async () => {
  await opened(withSubIssues);
  const subIssues = list('subIssues');
  assert.equal(fireEvent.contextMenu(rowButton(subIssues, 11)), true, 'the closed row keeps the system menu');
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(fireEvent.contextMenu(rowButton(subIssues, 10)), false);
  await waitFor(() => assert.equal(document.activeElement, menu(10)));
  assert.ok(subIssues.contains(menu(10)));
});

test("the current issue's sibling row offers no dispatch, by button or right click, while another open sibling does", async () => {
  await opened(withSiblings);
  const siblings = list('siblingIssues');
  assert.equal(within(siblings).getAllByRole('button', { name: t('dispatch') }).length, 1);
  assert.equal(fireEvent.contextMenu(rowButton(siblings, 9)), true);
  assert.equal(screen.queryByRole('menu'), null);
  assert.equal(fireEvent.contextMenu(rowButton(siblings, 12)), false);
  await waitFor(() => assert.ok(siblings.contains(menu(12))));
});

test('⌘D on a focused sibling row opens that row’s Dispatch menu, and ⌘L locates its latest dispatch', async () => {
  const f = await opened(withSiblings, undefined, snapshot => {
    snapshot.projects[0].dispatches = [record(12, { projectId: 'beta', panelId: 'beta-panel' })];
  });
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
  };
  const siblings = list('siblingIssues');
  rowButton(siblings, 12).focus();
  assert.equal(pressCommandKey('KeyD'), false);
  await waitFor(() => assert.equal(document.activeElement, menu(12)));
  assert.ok(siblings.contains(menu(12)), 'the menu opens on the sibling row, not in the head');
  await f.user.keyboard('{Escape}');
  await waitFor(() => assert.equal(screen.queryByRole('menu'), null));
  rowButton(siblings, 9).focus();
  assert.equal(pressCommandKey('KeyD'), true, "the current issue's row is not dispatched");
  rowButton(siblings, 12).focus();
  assert.equal(pressCommandKey('KeyL'), false);
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});
