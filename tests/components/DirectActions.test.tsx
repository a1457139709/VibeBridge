import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import type {
  DirectAction,
  DirectActionResult,
  ForgeFailure,
  IssueDetail,
  PullRequestDetail,
} from '../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './support/workbench';
import { forgeSidebarData, workbenchEvents } from './support/forge-sidebar-data';
import { githubForge, githubView, githubRepository } from './support/forge';
import { issue as listedIssue, pullRequest as listedPullRequest, stubSidebarApis } from './support/forge-lists';
import { requireValue } from '../../app/renderer/common/required';
import { descriptionParts } from './support/elements';
import { t } from './support/localization';
import { alertMessages, detailHeading, forgeSidebar } from './support/sidebar-queries';

afterEach(cleanup);
before(stubSidebarApis);

const repositoryUrl = 'https://github.com/octo/alpha';
const titles = { issue: 'Spec', pullRequest: 'Read-only detail' };
const links = { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` };
const issueDetail = (number: number, extra: Partial<IssueDetail> = {}): IssueDetail => {
  const {
    blockedBy: _,
    unlistedBlockers: __,
    parent: ___,
    subIssues: ____,
    ...summary
  } = listedIssue(number, { title: titles.issue });
  return {
    ...summary,
    url: `${repositoryUrl}/issues/${number}`,
    author: 'mona',
    assignees: [],
    body: '',
    comments: [],
    commentCount: 0,
    parent: null,
    subIssues: [],
    subIssueProgress: { closed: 0, total: 0 },
    blockedBy: [],
    blocking: [],
    closingPullRequests: [],
    links,
    canWrite: true,
    ...extra,
  };
};
const pullDetail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { title: titles.pullRequest });
  return {
    ...summary,
    url: `${repositoryUrl}/pull/${number}`,
    changesUrl: `${repositoryUrl}/pull/${number}/files`,
    head: 'feature',
    base: 'main',
    body: '',
    timeline: [],
    earlierEntries: 0,
    closingIssues: [],
    links,
    reviewDecision: null,
    checks: { state: null, counts: [], total: 0, url: `${repositoryUrl}/pull/${number}/checks`, listed: [] },
    mergeState: 'clean',
    mergeOptions: { methods: ['merge', 'squash', 'rebase'], defaultMethod: 'merge', queue: false },
    canWrite: true,
    ...extra,
  };
};

interface Forge {
  issue?: IssueDetail;
  pullRequest?: PullRequestDetail;
}
interface ActionRequest {
  action: DirectAction;
  answer(result: DirectActionResult): void;
}

function renderWorkbench(forge: Forge) {
  const project: ProjectView = {
    id: 'alpha',
    name: 'Alpha',
    directory: '/work/alpha',
    layout: { panel: 'panel' },
    tray: [],
    repository: githubRepository('octo/alpha'),
    ...githubView,
    panels: [
      {
        id: 'panel',
        agent: 'codex',
        run: { id: 'run', panelId: 'panel', projectId: 'alpha', state: 'running', title: 'Alpha session' },
      },
    ],
  };
  const snapshot: Snapshot = {
    navigation: { visible: true, width: 212 },
    forgeSidebar: { visible: true, width: 380 },
    activeProjectId: 'alpha',
    settings: defaultSettings(),
    settingsConflicts: [],
    startupTheme: 'light',
    resolvedTheme: 'light',
    errors: [],
    projects: [project],
  };
  const actions: ActionRequest[] = [];
  const reads = { issue: 0, pullRequest: 0, pages: 0, rows: 0 };
  const events = workbenchEvents();
  provideWorkbench({
    fetchSnapshot: async () => structuredClone(snapshot),
    reportRendererReady: async () => {},
    subscribe: events.subscribe,
    saveSidebar: async () => {},
    activateProject: async () => {},
    saveLayout: async () => {},
    ...forgeSidebarData(
      {
        issuePage: async () => {
          reads.pages++;
          return {
            ok: true,
            items: [listedIssue(3, { title: titles.issue })],
            nextCursor: null,
            labels: [],
            counts: { open: 1, closed: 0 },
          };
        },
        pullRequestPage: async () => {
          reads.pages++;
          return {
            ok: true,
            items: [listedPullRequest(12, { title: titles.pullRequest })],
            nextCursor: null,
            labels: [],
            counts: { open: 1, closed: 0 },
          };
        },
        issuesByNumber: async (_, numbers) => {
          reads.rows++;
          const { title, state, closedAs } = requireValue(forge.issue, 'the forge issue');
          return { ok: true, items: numbers.includes(3) ? [listedIssue(3, { title, state, closedAs })] : [] };
        },
        issueDetail: async () => {
          reads.issue++;
          return { ok: true, issue: structuredClone(requireValue(forge.issue, 'the forge issue')) };
        },
        pullRequestDetail: async () => {
          reads.pullRequest++;
          return { ok: true, pullRequest: structuredClone(requireValue(forge.pullRequest, 'the forge pull request')) };
        },
      },
      events.emit,
    ),
    performDirectAction: (_, action) => {
      const answer = deferred<DirectActionResult>();
      actions.push({ action, answer: answer.resolve });
      return answer.promise;
    },
  });
  render(<App />);
  const action = (count: number) =>
    waitFor(() => {
      assert.equal(actions.length, count, 'direct actions asked for');
      return actions[count - 1];
    });
  return { user: userEvent.setup(), action, reads };
}

const issuePane = () => within(forgeSidebar()).getByRole('region', { name: t('issueDetail') });
const pullPane = () => within(forgeSidebar()).getByRole('region', { name: t('pullRequestDetail') });
const forgeName = githubForge.name;
const mergeButtons = () =>
  within(within(pullPane()).getByRole('region', { name: t('mergeRequirements') }))
    .queryAllByRole('button')
    .map(button => button.textContent);
const failure = (detail: string): DirectActionResult => ({
  ok: false,
  failure: { kind: 'transient', detail, forge: githubForge },
});

async function openIssue(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(
    await within(await screen.findByRole('complementary', { name: forgeName })).findByRole('button', {
      name: titles.issue,
    }),
  );
  await detailHeading(issuePane(), titles.issue, 3);
  return view;
}
async function openPullRequest(forge: Forge) {
  const view = renderWorkbench(forge);
  await view.user.click(
    within(await screen.findByRole('complementary', { name: forgeName })).getByRole('tab', {
      name: t('pullRequestsTab'),
    }),
  );
  await view.user.click(await within(forgeSidebar()).findByRole('button', { name: titles.pullRequest }));
  await detailHeading(pullPane(), titles.pullRequest, 12);
  return view;
}

test('Close issue closes it as completed, shows it working meanwhile, and on success reloads the issue to show what the forge holds in its detail and its row', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action, reads } = await openIssue(forge);
  const pagesBefore = reads.pages,
    detailsBefore = reads.issue,
    rowsBefore = reads.rows;
  await user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  const asked = await action(1);
  assert.deepEqual(asked.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  await within(issuePane()).findByRole('button', { name: t('actionWorking') });
  assert.ok(
    within(issuePane())
      .getByRole('button', { name: t('moreCloseOptions') })
      .hasAttribute('disabled'),
    'the other actions wait',
  );
  forge.issue = issueDetail(3, { state: 'closed', closedAs: 'completed' });
  asked.answer({ ok: true, detail: '✓ Closed issue octo/alpha#3 (Spec)' });
  await within(issuePane()).findByRole('button', { name: t('reopenIssue') });
  await waitFor(() =>
    assert.deepEqual(
      [reads.issue - detailsBefore, reads.rows - rowsBefore, reads.pages - pagesBefore],
      [1, 1, 0],
      'one reload of the detail and the row by number, and no page',
    ),
  );
  const row = within(forgeSidebar()).getByRole('listitem');
  assert.ok(within(row).getByRole('img', { name: t('issueCompleted') }), 'the row stays, showing the new state');
  assert.equal(within(issuePane()).queryByRole('button', { name: t('closeIssue') }), null);
});

test('the close menu closes an issue as not planned, and a closed issue reopens', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: t('moreCloseOptions') }));
  const menu = within(issuePane()).getByRole('menu', { name: t('moreCloseOptions') });
  assert.deepEqual(
    within(menu)
      .getAllByRole('menuitem')
      .map(item => item.textContent),
    [t('closeAsCompleted'), t('closeAsNotPlanned')],
  );
  await user.click(within(menu).getByRole('menuitem', { name: t('closeAsNotPlanned') }));
  const close = await action(1);
  assert.deepEqual(close.action, { kind: 'closeIssue', number: 3, reason: 'notPlanned' });
  forge.issue = issueDetail(3, { state: 'closed', closedAs: 'notPlanned' });
  close.answer({ ok: true, detail: '' });
  await user.click(await within(issuePane()).findByRole('button', { name: t('reopenIssue') }));
  assert.deepEqual((await action(2)).action, { kind: 'reopenIssue', number: 3 });
});

test('a failed action shows the forge text under the buttons with Retry until dismissed or the next refresh', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  (await action(1)).answer(failure('HTTP 502: Server Error (https://api.github.com/graphql)'));
  const alert = await within(issuePane()).findByRole('alert');
  assert.deepEqual(descriptionParts(within(alert).getByRole('button', { name: t('retry') })), [
    t('actionFailed', {
      action: t('closeAsCompleted'),
      reason: 'HTTP 502: Server Error (https://api.github.com/graphql)',
    }),
  ]);
  assert.ok(
    !within(issuePane())
      .getByRole('button', { name: t('closeIssue') })
      .hasAttribute('disabled'),
  );

  await user.click(within(alert).getByRole('button', { name: t('retry') }));
  const retried = await action(2);
  assert.deepEqual(retried.action, { kind: 'closeIssue', number: 3, reason: 'completed' });
  await waitFor(() => assert.equal(within(issuePane()).queryByRole('alert'), null, 'retrying clears the failure'));
  retried.answer(failure('Still failing'));
  await user.click(
    within(await within(issuePane()).findByRole('alert')).getByRole('button', { name: t('dismissFailure') }),
  );
  assert.equal(within(issuePane()).queryByRole('alert'), null);

  await user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  (await action(3)).answer(failure('Again'));
  await within(issuePane()).findByRole('alert');
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('refresh') }));
  await waitFor(() =>
    assert.equal(within(issuePane()).queryByRole('alert'), null, 'the next refresh clears the failure'),
  );
});

test('an action that finds the forge CLI missing or logged out puts the sidebar in that failure state', async () => {
  const forge: Forge = { issue: issueDetail(3), pullRequest: pullDetail(12) };
  const missing = await openIssue(forge);
  await missing.user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  const notInstalled: ForgeFailure = { kind: 'notInstalled', detail: '', forge: githubForge };
  (await missing.action(1)).answer({ ok: false, failure: notInstalled });
  await waitFor(() => assert.deepEqual(alertMessages(), [t('forgeCliMissing', { cli: githubForge.cli })]));
  assert.equal(
    within(forgeSidebar()).queryByRole('region', { name: t('issueDetail') }),
    null,
    'the failure fills the content area',
  );
  cleanup();

  const loggedOut = await openPullRequest(forge);
  await loggedOut.user.click(within(pullPane()).getByRole('button', { name: t('closePullRequest') }));
  (await loggedOut.action(1)).answer({
    ok: false,
    failure: { kind: 'loggedOut', detail: 'HTTP 401: Bad credentials', forge: githubForge },
  });
  await within(forgeSidebar()).findByRole('button', { name: t('copyCommand', { command: githubForge.loginCommand }) });
});

test('with no write access to the repository, a detail shows no action buttons', async () => {
  const forge: Forge = { issue: issueDetail(3, { canWrite: false }), pullRequest: pullDetail(12, { canWrite: false }) };
  await openIssue(forge);
  assert.equal(within(issuePane()).queryByRole('button', { name: t('closeIssue') }), null);
  cleanup();
  await openPullRequest(forge);
  assert.deepEqual(mergeButtons(), []);
});

test('the method menu lists only the methods the repository allows and starts from the forge default method', async () => {
  const forge: Forge = {
    pullRequest: pullDetail(12, {
      mergeOptions: { methods: ['squash', 'rebase'], defaultMethod: 'rebase', queue: false },
    }),
  };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: t('chooseMergeMethod') }));
  const menu = within(pullPane()).getByRole('menu', { name: t('chooseMergeMethod') });
  assert.deepEqual(
    within(menu)
      .getAllByRole('menuitemradio')
      .map(item => [item.textContent, item.getAttribute('aria-checked')]),
    [
      [t('mergeMethodSquash'), 'false'],
      [t('mergeMethodRebase'), 'true'],
    ],
  );
  await user.click(within(menu).getByRole('menuitemradio', { name: t('mergeMethodSquash') }));
  await user.click(within(pullPane()).getByRole('button', { name: t('mergeMethodSquash') }));
  await user.click(within(pullPane()).getByRole('button', { name: t('confirmMergeSquash') }));
  assert.deepEqual((await action(1)).action, { kind: 'merge', number: 12, method: 'squash' });
});

test('when the forge default method is not one the repository allows, merging starts from the first allowed method', async () => {
  const forge: Forge = {
    pullRequest: pullDetail(12, {
      mergeOptions: { methods: ['squash', 'rebase'], defaultMethod: 'merge', queue: false },
    }),
  };
  await openPullRequest(forge);
  within(pullPane()).getByRole('button', { name: t('mergeMethodSquash') });
});

test('merging takes two clicks in place: the method, then its confirmation', async () => {
  const forge: Forge = { pullRequest: pullDetail(12) };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: t('mergeMethodMerge') }));
  await user.click(within(pullPane()).getByRole('button', { name: t('confirmMergeMerge') }));
  const merge = await action(1);
  assert.deepEqual(merge.action, { kind: 'merge', number: 12, method: 'merge' });
  await within(pullPane()).findByRole('button', { name: t('merging') });
  assert.ok(
    within(pullPane())
      .getByRole('button', { name: t('closePullRequest') })
      .hasAttribute('disabled'),
    'the other actions wait',
  );
  forge.pullRequest = pullDetail(12, { state: 'merged' });
  merge.answer({ ok: true, detail: '' });
  await within(pullPane()).findByRole('group', { name: t('stateMerged') });
  assert.equal(within(pullPane()).queryByRole('alert'), null);
  assert.deepEqual(mergeButtons(), [], 'a merged pull request has no actions');
});

test('a pull request closes, and a closed one reopens', async () => {
  const forge: Forge = { pullRequest: pullDetail(12) };
  const { user, action } = await openPullRequest(forge);
  await user.click(within(pullPane()).getByRole('button', { name: t('closePullRequest') }));
  const close = await action(1);
  assert.deepEqual(close.action, { kind: 'closePullRequest', number: 12 });
  forge.pullRequest = pullDetail(12, { state: 'closed' });
  close.answer({ ok: true, detail: '' });
  await user.click(await within(pullPane()).findByRole('button', { name: t('reopenPullRequest') }));
  assert.deepEqual((await action(2)).action, { kind: 'reopenPullRequest', number: 12 });
});

const mergeReasons = () => descriptionParts(within(pullPane()).getByRole('button', { name: t('chooseMergeMethod') }));
const mergeDisabled = () =>
  [t('mergeMethodMerge'), t('chooseMergeMethod')].map(name =>
    within(pullPane()).getByRole('button', { name }).hasAttribute('disabled'),
  );

for (const [state, mergeState, reasons] of [
  ['open', 'clean', []],
  ['open', 'hasHooks', []],
  ['open', 'unstable', []],
  ['open', 'dirty', [t('mergeBlockedDirty')]],
  ['open', 'behind', [t('mergeBlockedBehind', { base: 'main' })]],
  ['open', 'blocked', [t('mergeBlockedBlocked', { forge: forgeName })]],
  ['open', 'unknown', [t('mergeBlockedUnknown', { forge: forgeName })]],
  ['draft', 'blocked', [t('mergeBlockedDraft'), t('mergeBlockedBlocked', { forge: forgeName })]],
  ['draft', 'clean', [t('mergeBlockedDraft')]],
  ['draft', null, [t('mergeBlockedDraft')]],
] as const) {
  test(`${state === 'draft' ? 'a draft' : 'an open'} pull request whose merge state is ${mergeState} ${reasons.length ? 'cannot be merged and says why' : 'can be merged'}`, async () => {
    await openPullRequest({ pullRequest: pullDetail(12, { state, mergeState }) });
    const blocked = !!reasons.length;
    assert.deepEqual(
      [mergeDisabled(), mergeReasons()],
      [[blocked, blocked], blocked ? [t('cannotMerge', { reasons: [...reasons] })] : []],
    );
    assert.ok(
      !within(pullPane())
        .getByRole('button', { name: t('closePullRequest') })
        .hasAttribute('disabled'),
      'closing is never blocked',
    );
  });
}

test('a repository that merges through a merge queue greys out merging and links the pull request on the forge', async () => {
  const forge: Forge = {
    pullRequest: pullDetail(12, { mergeOptions: { methods: ['squash'], defaultMethod: 'squash', queue: true } }),
  };
  await openPullRequest(forge);
  const merge = within(pullPane()).getByRole('button', { name: t('mergeButton') });
  assert.ok(merge.hasAttribute('disabled'));
  assert.deepEqual(descriptionParts(merge), [t('mergeQueueNote')]);
  const note = requireValue(merge.parentElement, 'the merge note');
  assert.equal(
    within(note)
      .getByRole('link', { name: t('openOnForge', { forge: forgeName }) })
      .getAttribute('href'),
    `${repositoryUrl}/pull/12`,
  );
});
