import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { IssueDetail } from '../../app/shared/forge/forge';
import type { DispatchRecordView } from '../../app/shared/dispatch';
import type { Snapshot } from '../../app/shared/model';
import { t } from './support/localization';
import { stubSidebarApis } from './support/forge-lists';
import {
  issueButton,
  issueDetail as detail,
  listed,
  menu,
  panelOf,
  record,
  targetsMenu,
  trayTitle,
  commandNamed,
} from './support/dispatch';
import { agentNames } from '../../app/shared/model';
import { requireValue } from '../../app/renderer/common/required';
import { selectElement } from './support/elements';
import { forgeSidebar, detailHeading } from './support/sidebar-queries';
import { nameIncluding } from './support/accessible-names';

afterEach(cleanup);
before(stubSidebarApis);

async function opened(
  issue: IssueDetail,
  change: (snapshot: Snapshot) => void = () => {},
  dispatch?: Parameters<typeof listed>[0],
) {
  const f = await listed(dispatch, change);
  f.forge.issueDetail = async () => ({ ok: true, issue });
  await f.user.click(issueButton(issue.number));
  await detailHeading(pane(), issue.title, issue.number);
  return f;
}
const pane = () => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') });
const records = (count: number) => within(pane()).getByRole('region', { name: t('dispatchRecords', { count }) });
const implement = 'implement',
  toSpec = 'to-spec',
  grillMe = 'grill-me',
  tdd = 'tdd';
const aged = (hours: number, location: DispatchRecordView['location'], extra: Partial<DispatchRecordView> = {}) =>
  record(9, location, { dispatchedAt: new Date(Date.now() - hours * 3600e3).toISOString(), ...extra });

test("an open issue's detail has a Dispatch beside its state and labels that opens the same menu as its row", async () => {
  const f = await opened(detail(9));
  const head = selectElement('.forge-doc-head', pane());
  await f.user.click(within(head).getByRole('button', { name: t('dispatch') }));
  const shown = await waitFor(() => menu());
  await waitFor(() => assert.equal(document.activeElement, shown));
  assert.equal(within(shown).getAllByRole('menuitem').length, 12);
  await f.user.hover(within(shown).getByRole('menuitem', commandNamed(implement, ['submit'])));
  await f.user.click(
    within(await waitFor(() => targetsMenu(implement))).getByRole('menuitem', { name: nameIncluding(trayTitle) }),
  );
  await waitFor(() =>
    assert.deepEqual(f.dispatches, [
      [
        'alpha',
        {
          issue: { number: 9, title: detail(9).title },
          workflowId: 'matt',
          commandId: implement,
          target: { kind: 'panel', panelId: 'tray' },
          invertDelivery: false,
        },
      ],
    ]),
  );
});

test("filling a panel from the detail's Dispatch locates the panel and closes the detail", async () => {
  const f = await opened(detail(9), undefined, async (_, request) => ({
    delivery: 'fill',
    panelId: panelOf(request),
  }));
  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
  };
  await f.user.click(within(selectElement('.forge-doc-head', pane())).getByRole('button', { name: t('dispatch') }));
  await f.user.hover(within(menu()).getByRole('menuitem', commandNamed(implement, ['submit'])));
  await f.user.click(within(targetsMenu(implement)).getByRole('menuitem', { name: nameIncluding(trayTitle) }));
  await waitFor(() => assert.deepEqual(activated, ['alpha'], "the filled panel's project is shown"));
  assert.equal(within(forgeSidebar()).queryByRole('region', { name: t('issueDetail') }), null);
});

test("a closed issue's detail has no Dispatch", async () => {
  await opened(detail(8, { state: 'closed', closedAs: 'completed' }));
  assert.equal(within(pane()).queryByRole('button', { name: t('dispatch') }), null);
});

const line = (item: HTMLElement) =>
  [...item.querySelectorAll<HTMLElement>(':scope > *')].map(part =>
    part.getAttribute('role') === 'img' ? part.getAttribute('aria-label') : part.textContent,
  );

test("Dispatch records list the issue's dispatches newest first, one line each: when, the Agent type, the skill and the session ID", async () => {
  const located = aged(2, { projectId: 'beta', panelId: 'beta-panel' }, { skill: grillMe, sessionId: 'ccccdddd-1111' });
  const f = await opened(detail(9), snapshot => {
    snapshot.projects[0].dispatches = [
      aged(50, null, { agent: 'claude', skill: toSpec, sessionId: 'aaaabbbb-1111-2222-3333-444455556666' }),
      located,
      aged(1, { projectId: 'alpha', panelId: 'tray' }, { skill: tdd, sessionId: undefined }),
      record(8, null),
    ];
  });
  assert.equal(
    within(records(3))
      .getByRole('button', { name: t('dispatchRecords', { count: 3 }) })
      .getAttribute('aria-expanded'),
    'true',
    'an open issue shows its records unfolded',
  );
  const shown = within(records(3)).getAllByRole('listitem');
  assert.deepEqual(shown.map(line), [
    [t('hoursAgo', { count: 1 }), agentNames.codex, tdd],
    [t('hoursAgo', { count: 2 }), agentNames.codex, grillMe, 'ccccdddd'],
    [t('daysAgo', { count: 2 }), agentNames.claude, toSpec, 'aaaabbbb'],
  ]);
  assert.deepEqual(
    shown.map((item, index) => !!within(item).queryByRole('button', { name: [tdd, grillMe, toSpec][index] })),
    [true, true, false],
    'the skill locates only when a panel is on its session',
  );
  assert.equal(
    requireValue(shown[2].querySelector('.dispatch-skill'), 'the skill of the oldest record').getAttribute('data-hint'),
    t('dispatchSkillGone', { skill: toSpec, age: t('daysAgo', { count: 2 }) }),
  );

  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  await f.user.click(within(shown[1]).getByRole('button', { name: located.skill }));
  await waitFor(() => assert.deepEqual(activated, ['beta']));
});

test("clicking a record's session ID copies the full ID and says so briefly, whether or not a panel is on it", async () => {
  const sessionId = 'aaaabbbb-1111-2222-3333-444455556666';
  const f = await opened(detail(9), snapshot => {
    snapshot.projects[0].dispatches = [aged(50, null, { sessionId })];
  });
  const copied: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  const id = within(records(1)).getByRole('button', { name: t('copySessionId', { id: sessionId }) });
  assert.equal(id.getAttribute('data-hint'), sessionId, 'the hint gives the full ID');
  await f.user.click(id);
  await waitFor(() => assert.deepEqual(copied, [sessionId]));
  await waitFor(() =>
    assert.ok(screen.getAllByRole('status').some(notice => notice.textContent?.includes(t('sessionIdCopied')))),
  );
});

test('an issue with no dispatches has no Dispatch records', async () => {
  await opened(detail(9));
  assert.equal(pane().querySelector('.dispatch-records'), null);
});

test("a closed issue's Dispatch records fold to their count and unfold on click", async () => {
  const f = await opened(detail(8, { state: 'closed', closedAs: 'completed' }), snapshot => {
    snapshot.projects[0].dispatches = [record(8, null), record(8, { projectId: 'alpha', panelId: 'tray' })];
  });
  const toggle = within(records(2)).getByRole('button', { name: t('dispatchRecords', { count: 2 }) });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(within(records(2)).queryAllByRole('listitem'), []);
  await f.user.click(toggle);
  await waitFor(() => assert.equal(within(records(2)).getAllByRole('listitem').length, 2));
});

test('turning a workflow off leaves the records of its dispatches showing', async () => {
  await opened(detail(9), snapshot => {
    snapshot.settings.workflows.matt.enabled = false;
    snapshot.projects[0].dispatches = [record(9, null)];
  });
  assert.equal(within(records(1)).getAllByRole('listitem').length, 1);
});
