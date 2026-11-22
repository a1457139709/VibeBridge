import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { IssueDetail } from '../../app/shared/forge/forge';
import type { DispatchRecordView } from '../../app/shared/dispatch';
import type { Snapshot } from '../../app/shared/model';
import { localize } from '../../app/shared/localization/localization';
import { sidebar, stubSidebarApis } from './support/forge-lists';
import { issueDetail as detail, listed, record, row } from './support/dispatch';
import { selectElement } from './support/elements';

afterEach(cleanup);
before(stubSidebarApis);

async function opened(issue: IssueDetail, change: (snapshot: Snapshot) => void = () => {}) {
  const f = await listed(undefined, change);
  f.forge.issueDetail = async () => ({ ok: true, issue });
  await f.user.click(within(row(issue.number)).getByRole('button', { name: `Issue ${issue.number}` }));
  await within(pane()).findByRole('heading', { name: `Issue ${issue.number} #${issue.number}` });
  return f;
}
const pane = () => within(sidebar()).getByRole('region', { name: 'Issue detail' });
const records = () => within(pane()).getByRole('region', { name: /^Dispatch records/ });
const aged = (hours: number, location: DispatchRecordView['location'], extra: Partial<DispatchRecordView> = {}) =>
  record(9, location, { dispatchedAt: new Date(Date.now() - hours * 3600e3).toISOString(), ...extra });

test("an open issue's detail has a Dispatch beside its state and labels that opens the same menu as its row", async () => {
  const f = await opened(detail(9));
  const head = selectElement('.forge-doc-head', pane());
  await f.user.click(within(head).getByRole('button', { name: 'Dispatch' }));
  const menu = await waitFor(() => screen.getByRole('menu', { name: 'Dispatch #9' }));
  await waitFor(() => assert.equal(document.activeElement, menu));
  assert.equal(within(menu).getAllByRole('menuitem').length, 12);
  await f.user.hover(within(menu).getByRole('menuitem', { name: /^implement\s?Submit$/ }));
  await f.user.click(
    within(await waitFor(() => screen.getByRole('menu', { name: 'Targets for implement' }))).getByRole('menuitem', {
      name: /Fix it/,
    }),
  );
  await waitFor(() =>
    assert.deepEqual(f.dispatches, [
      [
        'alpha',
        {
          issue: { number: 9, title: 'Issue 9' },
          workflowId: 'matt',
          commandId: 'implement',
          target: { kind: 'panel', panelId: 'tray' },
          invertDelivery: false,
        },
      ],
    ]),
  );
});

test("a closed issue's detail has no Dispatch", async () => {
  await opened(detail(8, { state: 'closed', closedAs: 'completed' }));
  assert.equal(within(pane()).queryByRole('button', { name: 'Dispatch' }), null);
});

const { t } = localize('en');
const line = (item: HTMLElement) =>
  [...item.querySelectorAll<HTMLElement>(':scope > *')].map(part =>
    part.getAttribute('role') === 'img' ? part.getAttribute('aria-label') : part.textContent,
  );

test("Dispatch records list the issue's dispatches newest first, one line each: when, the Agent type, the skill and the session ID", async () => {
  const f = await opened(detail(9), snapshot => {
    snapshot.projects[0].dispatches = [
      aged(50, null, { agent: 'claude', skill: 'to-spec', sessionId: 'aaaabbbb-1111-2222-3333-444455556666' }),
      aged(2, { projectId: 'beta', panelId: 'beta-panel' }, { skill: 'grill-me', sessionId: 'ccccdddd-1111' }),
      aged(1, { projectId: 'alpha', panelId: 'tray' }, { skill: 'tdd', sessionId: undefined }),
      record(8, null),
    ];
  });
  const counted = within(pane()).getByRole('region', { name: t('dispatchRecords', { count: 3 }) });
  assert.equal(
    within(counted)
      .getByRole('button', { name: t('dispatchRecords', { count: 3 }) })
      .getAttribute('aria-expanded'),
    'true',
    'an open issue shows its records unfolded',
  );
  const shown = within(records()).getAllByRole('listitem');
  assert.deepEqual(shown.map(line), [
    [t('hoursAgo', { count: 1 }), 'Codex', 'tdd'],
    [t('hoursAgo', { count: 2 }), 'Codex', 'grill-me', 'ccccdddd'],
    [t('daysAgo', { count: 2 }), 'Claude Code', 'to-spec', 'aaaabbbb'],
  ]);
  assert.deepEqual(
    shown.map(item => !!within(item).queryByRole('button', { name: /^(tdd|grill-me|to-spec)$/ })),
    [true, true, false],
    'the skill locates only when a panel is on its session',
  );
  assert.equal(
    within(shown[2]).getByText('to-spec').getAttribute('data-hint'),
    t('dispatchSkillGone', { skill: 'to-spec', age: t('daysAgo', { count: 2 }) }),
  );

  const activated: string[] = [];
  window.workbench.activateProject = async id => {
    activated.push(id);
    f.snapshot.activeProjectId = id;
    f.publish();
  };
  await f.user.click(within(shown[1]).getByRole('button', { name: 'grill-me' }));
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
  const id = within(records()).getByRole('button', { name: t('copySessionId', { id: sessionId }) });
  assert.equal(id.getAttribute('data-hint'), sessionId, 'the hint gives the full ID');
  await f.user.click(id);
  await waitFor(() => assert.deepEqual(copied, [sessionId]));
  await screen.findByText(t('sessionIdCopied'));
});

test('an issue with no dispatches has no Dispatch records', async () => {
  await opened(detail(9));
  assert.equal(within(pane()).queryByRole('region', { name: /^Dispatch records/ }), null);
});

test("a closed issue's Dispatch records fold to their count and unfold on click", async () => {
  const f = await opened(detail(8, { state: 'closed', closedAs: 'completed' }), snapshot => {
    snapshot.projects[0].dispatches = [record(8, null), record(8, { projectId: 'alpha', panelId: 'tray' })];
  });
  const toggle = within(records()).getByRole('button', { name: t('dispatchRecords', { count: 2 }) });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(within(records()).queryAllByRole('listitem'), []);
  await f.user.click(toggle);
  await waitFor(() => assert.equal(within(records()).getAllByRole('listitem').length, 2));
});

test('turning a workflow off leaves the records of its dispatches showing', async () => {
  await opened(detail(9), snapshot => {
    snapshot.settings.workflows.matt.enabled = false;
    snapshot.projects[0].dispatches = [record(9, null)];
  });
  assert.equal(within(records()).getAllByRole('listitem').length, 1);
});
