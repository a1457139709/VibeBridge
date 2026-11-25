import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, within } from '@testing-library/react';
import { stubSidebarApis } from './support/forge-lists';
import {
  repositoryUrl,
  detail,
  success,
  failure,
  timedOut,
  inProgress,
  skipped,
  check,
  checks,
  mergeArea,
  rowOf,
  shownRow,
  openPullRequest,
} from './support/pull-request-detail';
import { t } from './support/localization';
import { descriptionParts } from './support/elements';
import type { CheckState } from '../../app/shared/forge/forge';
import { overrideCapabilities, testForgeCapabilities, testForge } from './support/forge';

afterEach(cleanup);
before(stubSidebarApis);

const checkItems = () => within(rowOf(t('checksRow'))).queryAllByRole('listitem');
const shownCheck = (name: string, ...description: string[]) => {
  const item = within(rowOf(t('checksRow'))).getByRole('listitem', { name });
  assert.deepEqual(descriptionParts(item), description, name);
  return item;
};
const checkMarks = (item: HTMLElement) => ({
  tone: item.querySelector(':scope > span')?.className,
  required: descriptionParts(item).includes(t('requiredCheck')),
  log:
    within(item)
      .queryByRole('link', { name: t('checkLog') })
      ?.getAttribute('href') ?? null,
});

test("the checks show the forge's overall state and every count, then each check in the forge's order with its workflow, raw conclusion, description, required mark, duration and log", async () => {
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
  assert.ok(
    shownRow(
      t('checksRow'),
      t('checksState', {
        outcome: t('checkFailure'),
        counts: [
          t('checkCount', { outcome: t('checkSuccess'), count: 40 }),
          t('checkCount', { outcome: t('checkTimedOut'), count: 2 }),
          t('checkCount', { outcome: t('checkInProgress'), count: 3 }),
        ],
      }),
    ),
  );
  const shown = [
    shownCheck('CI / lint', t('requiredCheck'), t('checkSuccess')),
    shownCheck(
      'CI / unit tests',
      t('requiredCheck'),
      t('checkTimedOut'),
      t('durationMinutes', { minutes: 30, seconds: 5 }),
      'Timed out after 30 minutes',
    ),
    shownCheck('e2e', t('checkInProgress')),
    shownCheck('docs', t('checkSkipped'), t('durationSeconds', { seconds: 0 })),
    shownCheck('build', t('checkSuccess'), t('durationHours', { hours: 1, minutes: 5 })),
    shownCheck('ci/legacy', t('checkSuccess')),
  ];
  assert.deepEqual(checkItems(), shown, "every check is listed, in the forge's order");
  const none = { required: false };
  assert.deepEqual(shown.map(checkMarks), [
    { tone: 'forge-open', required: true, log: `${repositoryUrl}/runs/lint` },
    { tone: 'forge-failed', required: true, log: `${repositoryUrl}/runs/unit tests` },
    { ...none, tone: 'forge-pending', log: `${repositoryUrl}/runs/e2e` },
    { ...none, tone: 'forge-skipped', log: `${repositoryUrl}/runs/docs` },
    { ...none, tone: 'forge-open', log: `${repositoryUrl}/runs/build` },
    { ...none, tone: 'forge-open', log: null },
  ]);
  const checksRow = within(rowOf(t('checksRow')));
  assert.deepEqual(
    checksRow.getAllByRole('link'),
    checksRow.getAllByRole('link', { name: t('checkLog') }),
    'nothing is left out, so the only links are the logs',
  );
});

test('a check state the sidebar does not know shows its raw value in the neutral group', async () => {
  const unrecognized = (raw: string): CheckState => ({ outcome: 'unrecognized', raw, tone: 'neutral' });
  await openPullRequest(
    detail(12, {
      checks: checks([check('unit tests', unrecognized('SUPERSEDED'))], {
        state: unrecognized('SUPERSEDED'),
        counts: [{ ...unrecognized('SUPERSEDED'), count: 1 }],
      }),
    }),
  );
  assert.ok(
    shownRow(
      t('checksRow'),
      t('checksState', { outcome: 'SUPERSEDED', counts: [t('checkCount', { outcome: 'SUPERSEDED', count: 1 })] }),
    ),
  );
  assert.equal(checkMarks(shownCheck('unit tests', 'SUPERSEDED')).tone, 'forge-skipped');
});

test('a check list the forge cut short says how many more there are and links the checks page', async () => {
  await openPullRequest(
    detail(12, {
      checks: checks(
        Array.from({ length: 100 }, (_, index) => check(`shard ${index}`)),
        { total: 116, counts: [{ ...success, count: 116 }] },
      ),
    }),
  );
  const more = within(rowOf(t('checksRow'))).getByRole('link', {
    name: t('moreChecks', { count: 16, forge: testForge.name }),
  });
  assert.equal(more.getAttribute('href'), `${repositoryUrl}/pull/12/checks`);
});

test('a pull request without checks says so', async () => {
  await openPullRequest(detail(12));
  assert.deepEqual([shownRow(t('checksRow'), t('checksNone')), checkItems()], [rowOf(t('checksRow')), []]);
});

const mergeRows = () => within(mergeArea()).getAllByRole('group');

test('the merge requirements read, in order, the review decision, the checks, the merge state, and the draft', async () => {
  await openPullRequest(detail(12, { state: 'draft', reviewDecision: 'changesRequested', mergeState: 'blocked' }));
  assert.deepEqual(mergeRows(), [t('reviewRow'), t('checksRow'), t('mergeStateRow'), t('draftRow')].map(rowOf));
  assert.ok(shownRow(t('draftRow'), t('draftNote', { forge: testForge.name })));
});

test('a draft for which the forge gives no merge state of its own is explained by the draft row alone', async () => {
  await openPullRequest(detail(12, { state: 'draft', mergeState: null }));
  assert.deepEqual(mergeRows(), [t('reviewRow'), t('checksRow'), t('draftRow')].map(rowOf));
});

for (const [reviewDecision, text] of [
  ['approved', t('reviewApproved')],
  ['changesRequested', t('reviewChangesRequested')],
  ['reviewRequired', t('reviewRequired')],
  [null, t('reviewNotRequired')],
] as const) {
  test(`a review decision of ${reviewDecision} reads: ${text}`, async () => {
    await openPullRequest(detail(12, { reviewDecision }));
    assert.ok(shownRow(t('reviewRow'), text));
  });
}

for (const [mergeState, tone, text] of [
  ['clean', 'open', t('mergeStateClean')],
  ['hasHooks', 'open', t('mergeStateClean')],
  ['unstable', 'pending', t('mergeStateUnstable')],
  ['dirty', 'failed', t('mergeStateDirty', { base: 'main' })],
  ['behind', 'failed', t('mergeStateBehind', { base: 'main' })],
  ['blocked', 'failed', t('mergeStateBlocked')],
  ['unknown', 'pending', t('mergeStateUnknown', { forge: testForge.name })],
] as const) {
  test(`a merge state of ${mergeState} reads: ${text}`, async () => {
    await openPullRequest(detail(12, { mergeState }));
    const row = shownRow(t('mergeStateRow'), text);
    assert.equal(row.querySelector(':scope > span')?.className, `forge-${tone}`);
    assert.equal(within(mergeArea()).queryByRole('group', { name: t('draftRow') }), null);
  });
}

for (const [state, text] of [
  ['merged', t('stateMerged')],
  ['closed', t('closedWithoutMerging')],
] as const) {
  test(`a ${state} pull request's merge area says only that it is ${state}, not what blocked a merge`, async () => {
    await openPullRequest(
      detail(12, { state, mergeState: 'dirty', checks: checks([check('lint', failure)]), canWrite: false }),
    );
    assert.deepEqual(
      within(mergeArea()).getAllByRole('group'),
      [within(mergeArea()).getByRole('group', { name: text })],
      'only the end state shows',
    );
  });
}

test('a forge without required checks marks none', async () => {
  await openPullRequest(detail(12, { checks: checks([check('unit tests', failure, { required: true })]) }), {
    capabilities: overrideCapabilities({ requiredChecks: false }),
  });
  assert.equal(descriptionParts(checkItems()[0]).includes(t('requiredCheck')), false);
});

const mergeControl = (name: string) => within(mergeArea()).getByRole('button', { name });

test('the merge control offers only the merge methods the forge declares', async () => {
  const { user } = await openPullRequest(detail(12), {
    capabilities: overrideCapabilities({ mergeMethods: ['squash', 'rebase'] }),
  });
  assert.ok(mergeControl(t('mergeMethodSquash')), 'merging starts from the first declared method');
  await user.click(mergeControl(t('chooseMergeMethod')));
  const menu = within(mergeArea()).getByRole('menu', { name: t('chooseMergeMethod') });
  assert.deepEqual(
    within(menu).getAllByRole('menuitemradio'),
    [t('mergeMethodSquash'), t('mergeMethodRebase')].map(name => within(menu).getByRole('menuitemradio', { name })),
  );
});

test('with one merge method declared, the merge control uses it without offering a choice', async () => {
  await openPullRequest(detail(12), { capabilities: overrideCapabilities({ mergeMethods: ['rebase'] }) });
  assert.ok(mergeControl(t('mergeMethodRebase')));
  assert.equal(!!within(mergeArea()).queryByRole('button', { name: t('chooseMergeMethod') }), false);
});

test('a forge without a merge queue merges in place even when the pull request reports one', async () => {
  await openPullRequest(detail(12, { mergeOptions: { methods: ['squash'], defaultMethod: 'squash', queue: true } }), {
    capabilities: overrideCapabilities({ mergeQueue: false }),
  });
  assert.equal(mergeControl(t('mergeMethodSquash')).hasAttribute('disabled'), false);
  assert.equal(!!within(mergeArea()).queryByRole('button', { name: t('mergeButton') }), false);
  assert.equal(!!within(mergeArea()).queryByRole('link', { name: t('openOnForge', { forge: testForge.name }) }), false);
});
