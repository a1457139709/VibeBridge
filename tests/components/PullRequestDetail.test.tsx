import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { App } from '../../app/renderer/Workbench';
import { defaultSettings } from '../../app/shared/settings/settings';
import type { ProjectView, Snapshot } from '../../app/shared/model';
import type {
  Check,
  CheckState,
  ForgeCapabilities,
  IssueDetailResult,
  PullRequestDetail,
  PullRequestDetailResult,
  PullRequestReference,
} from '../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './support/workbench';
import { forgeSidebarData, workbenchEvents } from './support/forge-sidebar-data';
import { githubCapabilities, githubView, githubRepository } from './support/forge';
import { issue as listedIssue, pullRequest as listedPullRequest, stubSidebarApis } from './support/forge-lists';
import { requireInstance, selectElement } from './support/elements';
import { localize } from '../../app/shared/localization/localization';

afterEach(cleanup);
before(stubSidebarApis);

const repositoryUrl = 'https://github.com/octo/alpha';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600e3).toISOString();
const links = { issuePrefix: `${repositoryUrl}/issues/`, pullRequestPrefix: `${repositoryUrl}/pull/` };
const detail = (number: number, extra: Partial<PullRequestDetail> = {}): PullRequestDetail => {
  const { checks: _, ...summary } = listedPullRequest(number, { createdAt: hoursAgo(50) });
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
    mergeOptions: { methods: ['merge', 'squash', 'rebase'], queue: false },
    canWrite: true,
    ...extra,
  };
};
const { t } = localize('en');
const success: CheckState = { outcome: 'success', tone: 'passed' };
const failure: CheckState = { outcome: 'failure', tone: 'failed' };
const timedOut: CheckState = { outcome: 'timedOut', tone: 'failed' };
const inProgress: CheckState = { outcome: 'inProgress', tone: 'pending' };
const skipped: CheckState = { outcome: 'skipped', tone: 'neutral' };
const check = (name: string, state: CheckState = success, extra: Partial<Check> = {}): Check => ({
  ...state,
  workflow: null,
  name,
  description: null,
  required: false,
  startedAt: null,
  completedAt: null,
  url: `${repositoryUrl}/runs/${name}`,
  ...extra,
});
const checks = (listed: Check[], extra: Partial<PullRequestDetail['checks']> = {}): PullRequestDetail['checks'] => ({
  state: success,
  counts: [{ ...success, count: listed.length }],
  total: listed.length,
  url: `${repositoryUrl}/pull/12/checks`,
  listed,
  ...extra,
});

interface Request {
  kind: 'issue' | 'pullRequest';
  number: number;
  answer(result: IssueDetailResult | PullRequestDetailResult): void;
}

function renderWorkbench({
  capabilities = githubCapabilities,
  closingPullRequests = [],
}: { capabilities?: ForgeCapabilities; closingPullRequests?: PullRequestReference[] } = {}) {
  const project: ProjectView = {
    id: 'alpha',
    name: 'Alpha',
    directory: '/work/alpha',
    layout: { panel: 'panel' },
    tray: [],
    repository: githubRepository('octo/alpha'),
    ...githubView,
    capabilities,
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
  const requests: Request[] = [];
  const ask = <Result extends IssueDetailResult | PullRequestDetailResult>(kind: Request['kind'], number: number) => {
    const answer = deferred<Result>();
    requests.push({ kind, number, answer: answer.resolve });
    return answer.promise;
  };
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
        issuePage: async () => ({
          ok: true,
          items: [listedIssue(3, { title: 'Spec' })],
          nextCursor: null,
          labels: [],
          counts: { open: 1, closed: 0 },
        }),
        pullRequestPage: async () => ({
          ok: true,
          items: [listedPullRequest(12, { title: 'Read-only detail' })],
          nextCursor: null,
          labels: [],
          counts: { open: 1, closed: 0 },
        }),
        issueDetail: async (_, number) => {
          const result = await ask<IssueDetailResult>('issue', number);
          return result.ok ? { ...result, issue: { ...result.issue, closingPullRequests } } : result;
        },
        pullRequestDetail: (_, number) => ask<PullRequestDetailResult>('pullRequest', number),
      },
      events.emit,
    ),
  });
  render(<App />);
  const request = (count: number) =>
    waitFor(() => {
      assert.equal(requests.length, count, 'detail requests made');
      return requests[count - 1];
    });
  return { user: userEvent.setup(), request };
}

const sidebar = () => screen.getByRole('complementary', { name: 'GitHub' });
const pane = () => within(sidebar()).getByRole('region', { name: 'Pull request detail' });
const mergeArea = () => within(pane()).getByRole('region', { name: 'Merge requirements' });
const rowOf = (name: string) =>
  requireInstance(within(mergeArea()).getByText(name, { selector: 'b' }).closest('.forge-merge-row'), HTMLElement);

async function openPullRequest(pullRequest: PullRequestDetail, options: Parameters<typeof renderWorkbench>[0] = {}) {
  const view = renderWorkbench(options);
  await view.user.click(
    within(await screen.findByRole('complementary', { name: 'GitHub' })).getByRole('tab', { name: 'Pull requests' }),
  );
  await view.user.click(await within(sidebar()).findByRole('button', { name: 'Read-only detail' }));
  const first = await view.request(1);
  assert.deepEqual([first.kind, first.number], ['pullRequest', 12]);
  first.answer({ ok: true, pullRequest });
  await within(pane()).findByRole('heading', { name: `${pullRequest.title} #12` });
  return view;
}

test('a pull request row opens its detail: title, state, head into base, the changes on the forge, labels, and the issues it closes', async () => {
  const { user, request } = await openPullRequest(
    detail(12, {
      title: 'Read-only detail',
      head: 'feat/detail',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      closingIssues: [
        { number: 3, title: 'Spec', state: 'open', closedAs: null, url: `${repositoryUrl}/issues/3` },
        {
          number: 8,
          title: 'Elsewhere',
          state: 'closed',
          closedAs: 'completed',
          url: 'https://github.com/octo/other/issues/8',
        },
      ],
    }),
  );
  const doc = within(pane());
  assert.ok(doc.getByText('Open', { selector: '.forge-pill' }));
  assert.match(
    selectElement('.forge-pull-branches', pane()).textContent ?? '',
    /^mona wants to merge feat\/detail into main · 2d ago$/,
  );
  assert.equal(
    doc.getByRole('link', { name: 'View changes on GitHub ↗' }).getAttribute('href'),
    `${repositoryUrl}/pull/12/files`,
  );
  assert.ok(doc.getByText('bug'));
  const closes = doc.getByRole('group', { name: 'Closes on merge' });
  assert.equal(
    within(closes)
      .getByRole('link', { name: /Elsewhere/ })
      .getAttribute('href'),
    'https://github.com/octo/other/issues/8',
    'an issue of another repository opens in the browser',
  );
  await user.click(within(closes).getByRole('button', { name: /Spec/ }));
  const issue = await request(2);
  assert.deepEqual([issue.kind, issue.number], ['issue', 3], 'an issue of the bound repository opens in the sidebar');
  await user.click(within(sidebar()).getByRole('button', { name: 'Back' }));
  await within(pane()).findByRole('heading', { name: 'Read-only detail #12' });
});

test('the body, comments and review summaries follow in time order, reviews with their verdict', async () => {
  await openPullRequest(
    detail(12, {
      title: 'Timeline',
      body: '<p>The body.</p>',
      timeline: [
        { author: 'bob', createdAt: hoursAgo(4), html: '<p>Handle the draft row.</p>', verdict: 'changesRequested' },
        { author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null },
        { author: 'alice', createdAt: hoursAgo(2), html: '<p>LGTM</p>', verdict: 'approved' },
      ],
    }),
  );
  const cards = [...pane().querySelectorAll('.forge-card')].map(card => card.textContent);
  assert.deepEqual(cards, [
    'mona 2d agoThe body.',
    'bob Changes requested 4h agoHandle the draft row.',
    'hubot 3h agoRebased.',
    'alice Approved 2h agoLGTM',
  ]);
  assert.equal(pane().querySelector('.forge-earlier'), null, 'nothing came before the timeline');
  assert.ok(!within(pane()).queryByRole('button', { name: /Approve/ }), 'no approve button');
});

test('a timeline with earlier entries says how many at its top and links the pull request on the forge', async () => {
  await openPullRequest(
    detail(12, {
      body: '<p>The body.</p>',
      earlierEntries: 80,
      timeline: [{ author: 'hubot', createdAt: hoursAgo(3), html: '<p>Rebased.</p>', verdict: null }],
    }),
  );
  const earlier = within(pane()).getByRole('link', { name: t('earlierEntries', { count: 80, forge: 'GitHub' }) });
  assert.equal(earlier.getAttribute('href'), `${repositoryUrl}/pull/12`);
  const [body, comment] = [...pane().querySelectorAll('.forge-card')];
  assert.ok(
    body.compareDocumentPosition(earlier) & Node.DOCUMENT_POSITION_FOLLOWING &&
      earlier.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the notice sits between the body and the timeline',
  );
});

const shownChecks = () =>
  [...rowOf(t('checksRow')).querySelectorAll<HTMLElement>('.forge-merge-check')].map(item => ({
    tone: item.querySelector(':scope > span')?.className,
    name: item.querySelector('.forge-check-name')?.textContent,
    required: !!within(item).queryByText(t('requiredCheck')),
    outcome: item.querySelector('.forge-check-outcome')?.textContent,
    duration: item.querySelector('.forge-check-duration')?.textContent ?? null,
    description: item.querySelector('.forge-check-description')?.textContent ?? null,
    log:
      within(item)
        .queryByRole('link', { name: t('checkLog') })
        ?.getAttribute('href') ?? null,
  }));

test("the checks show GitHub's overall state and every count, then each check in GitHub's order with its workflow, raw conclusion, description, required mark, duration and log", async () => {
  await openPullRequest(
    detail(12, {
      checks: checks(
        [
          check('lint', success, { workflow: 'CI', required: true }),
          check('unit tests', timedOut, {
            workflow: 'CI',
            required: true,
            description: 'Timed out after 30 minutes',
            startedAt: '2026-01-02T10:00:00Z',
            completedAt: '2026-01-02T10:30:05Z',
          }),
          check('e2e', inProgress, { startedAt: '2026-01-02T10:00:00Z' }),
          check('docs', skipped, { startedAt: '2026-01-02T10:00:00Z', completedAt: '2026-01-02T10:00:00Z' }),
          check('build', success, { startedAt: '2026-01-02T10:00:00Z', completedAt: '2026-01-02T11:05:00Z' }),
          check('ci/legacy', success, { url: null }),
        ],
        {
          state: failure,
          counts: [
            { ...success, count: 40 },
            { ...timedOut, count: 2 },
            { ...inProgress, count: 3 },
          ],
          total: 6,
        },
      ),
    }),
  );
  assert.equal(
    selectElement('.forge-merge-row-head', rowOf(t('checksRow'))).textContent,
    `✗${t('checksRow')}${t('checksState', {
      outcome: t('checkFailure'),
      counts: [
        t('checkCount', { outcome: t('checkSuccess'), count: 40 }),
        t('checkCount', { outcome: t('checkTimedOut'), count: 2 }),
        t('checkCount', { outcome: t('checkInProgress'), count: 3 }),
      ],
    })}`,
  );
  const none = { required: false, duration: null, description: null };
  assert.deepEqual(shownChecks(), [
    {
      ...none,
      tone: 'forge-open',
      name: 'CI / lint',
      required: true,
      outcome: t('checkSuccess'),
      log: `${repositoryUrl}/runs/lint`,
    },
    {
      tone: 'forge-failed',
      name: 'CI / unit tests',
      required: true,
      outcome: t('checkTimedOut'),
      duration: t('durationMinutes', { minutes: 30, seconds: 5 }),
      description: 'Timed out after 30 minutes',
      log: `${repositoryUrl}/runs/unit tests`,
    },
    { ...none, tone: 'forge-pending', name: 'e2e', outcome: t('checkInProgress'), log: `${repositoryUrl}/runs/e2e` },
    {
      ...none,
      tone: 'forge-skipped',
      name: 'docs',
      outcome: t('checkSkipped'),
      duration: t('durationSeconds', { seconds: 0 }),
      log: `${repositoryUrl}/runs/docs`,
    },
    {
      ...none,
      tone: 'forge-open',
      name: 'build',
      outcome: t('checkSuccess'),
      duration: t('durationHours', { hours: 1, minutes: 5 }),
      log: `${repositoryUrl}/runs/build`,
    },
    { ...none, tone: 'forge-open', name: 'ci/legacy', outcome: t('checkSuccess'), log: null },
  ]);
  assert.equal(rowOf(t('checksRow')).querySelector('.forge-more-checks'), null, 'every check is listed');
});

test('a check list GitHub cut short says how many more there are and links the checks page', async () => {
  await openPullRequest(
    detail(12, {
      checks: checks(
        Array.from({ length: 100 }, (_, index) => check(`shard ${index}`)),
        { total: 116, counts: [{ ...success, count: 116 }] },
      ),
    }),
  );
  const more = within(rowOf(t('checksRow'))).getByRole('link', {
    name: t('moreChecks', { count: 16, forge: 'GitHub' }),
  });
  assert.equal(more.getAttribute('href'), `${repositoryUrl}/pull/12/checks`);
});

test('a pull request without checks says so', async () => {
  await openPullRequest(detail(12));
  assert.equal(
    selectElement('.forge-merge-row-head', rowOf(t('checksRow'))).textContent,
    `–${t('checksRow')}${t('checksNone')}`,
  );
});

const rowText = (name: string) => rowOf(name).querySelector(':scope > span:last-child')?.textContent;

test('the merge requirements read, in order, the review decision, the checks, the merge state, and the draft', async () => {
  await openPullRequest(detail(12, { state: 'draft', reviewDecision: 'changesRequested', mergeState: 'blocked' }));
  const rows = [
    ...mergeArea().querySelectorAll(
      ':scope > .forge-merge-row > b, :scope > .forge-merge-row > .forge-merge-row-head > b',
    ),
  ].map(name => name.textContent);
  assert.deepEqual(rows, [t('reviewRow'), t('checksRow'), t('mergeStateRow'), t('draftRow')]);
  assert.equal(rowText(t('draftRow')), t('draftNote', { forge: 'GitHub' }));
});

for (const [reviewDecision, text] of [
  ['approved', t('reviewApproved')],
  ['changesRequested', t('reviewChangesRequested')],
  ['reviewRequired', t('reviewRequired')],
  [null, t('reviewNotRequired')],
] as const) {
  test(`a review decision of ${reviewDecision} reads: ${text}`, async () => {
    await openPullRequest(detail(12, { reviewDecision }));
    assert.equal(rowText(t('reviewRow')), text);
  });
}

for (const [mergeState, tone, text] of [
  ['clean', 'open', t('mergeStateClean')],
  ['hasHooks', 'open', t('mergeStateClean')],
  ['unstable', 'pending', t('mergeStateUnstable')],
  ['dirty', 'failed', t('mergeStateDirty', { base: 'main' })],
  ['behind', 'failed', t('mergeStateBehind', { base: 'main' })],
  ['blocked', 'failed', t('mergeStateBlocked')],
  ['unknown', 'pending', t('mergeStateUnknown', { forge: 'GitHub' })],
] as const) {
  test(`a merge state of ${mergeState} reads: ${text}`, async () => {
    await openPullRequest(detail(12, { mergeState }));
    const row = rowOf(t('mergeStateRow'));
    assert.deepEqual(
      [row.querySelector(':scope > span')?.className, rowText(t('mergeStateRow'))],
      [`forge-${tone}`, text],
    );
    assert.equal(within(mergeArea()).queryByText(t('draftRow')), null);
  });
}

for (const [state, text] of [
  ['merged', 'Merged'],
  ['closed', 'Closed without merging'],
] as const) {
  test(`a ${state} pull request's merge area says only that it is ${state}, not what blocked a merge`, async () => {
    await openPullRequest(
      detail(12, { state, mergeState: 'dirty', checks: checks([check('lint', failure)]), canWrite: false }),
    );
    assert.equal(mergeArea().textContent, text);
  });
}

test('a forge without required checks marks none', async () => {
  await openPullRequest(detail(12, { checks: checks([check('unit tests', failure, { required: true })]) }), {
    capabilities: { ...githubCapabilities, requiredChecks: false },
  });
  assert.equal(within(mergeArea()).queryByText(t('requiredCheck')), null);
});

test('a pull request that closes an issue opens in the sidebar from the issue detail; one of another repository opens in the browser', async () => {
  const pull = (number: number, url: string): PullRequestReference => ({
    number,
    title: `Change ${number}`,
    state: 'open',
    checks: 'passed',
    url,
  });
  const { user, request } = renderWorkbench({
    closingPullRequests: [pull(12, `${repositoryUrl}/pull/12`), pull(40, 'https://github.com/octo/other/pull/40')],
  });
  await user.click(
    await within(await screen.findByRole('complementary', { name: 'GitHub' })).findByRole('button', { name: 'Spec' }),
  );
  const issue = await request(1);
  issue.answer({
    ok: true,
    issue: {
      ...listedIssue(3, { title: 'Spec' }),
      url: `${repositoryUrl}/issues/3`,
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
    },
  });
  const closing = await within(sidebar()).findByRole('region', {
    name: 'Pull requests that close this issue on merge',
  });
  assert.equal(
    within(closing)
      .getByRole('link', { name: /Change 40/ })
      .getAttribute('href'),
    'https://github.com/octo/other/pull/40',
  );
  await user.click(within(closing).getByRole('button', { name: /Change 12/ }));
  const opened = await request(2);
  assert.deepEqual([opened.kind, opened.number], ['pullRequest', 12]);
  opened.answer({ ok: true, pullRequest: detail(12, { title: 'Change 12' }) });
  await within(pane()).findByRole('heading', { name: 'Change 12 #12' });
});

test('a link to a pull request of the bound repository in the body opens it in the sidebar', async () => {
  const { user, request } = await openPullRequest(
    detail(12, { title: 'Linking', body: `<p>Follows <a href="${repositoryUrl}/pull/11">#11</a>.</p>` }),
  );
  await user.click(within(pane()).getByRole('link', { name: '#11' }));
  const next = await request(2);
  assert.deepEqual([next.kind, next.number], ['pullRequest', 11]);
});
