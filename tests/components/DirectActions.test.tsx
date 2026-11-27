import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import type { ForgeFailure } from '../../app/shared/forge/forge';
import { testForge, testForgeUrl } from './support/forge';
import { stubSidebarApis } from './support/forge-lists';
import { requireValue } from '../../app/renderer/common/required';
import { descriptionParts } from './support/elements';
import { t } from './support/localization';
import { alertMessages, detailHeading, forgeSidebar } from './support/sidebar-queries';
import {
  failure,
  forgeName,
  issueDetail,
  issuePane,
  mergeButtons,
  openIssue,
  openPullRequest,
  pullDetail,
  pullPane,
  repositoryUrl,
  titles,
  type Forge,
} from './support/direct-actions';

afterEach(cleanup);
before(stubSidebarApis);

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
  asked.answer({ ok: true, detail: '✓ Closed issue ada/alpha#3 (Spec)' });
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

test('the close menu stays open for a press inside it, and Escape or a press outside closes only the menu', async () => {
  const { user } = await openIssue({ issue: issueDetail(3) });
  const more = within(issuePane()).getByRole('button', { name: t('moreCloseOptions') });
  const menu = () => within(issuePane()).queryByRole('menu', { name: t('moreCloseOptions') });
  await user.click(more);
  await user.pointer({ keys: '[MouseLeft>]', target: requireValue(menu(), 'the open menu') });
  await user.pointer({ keys: '[/MouseLeft]' });
  assert.notEqual(menu(), null);
  await user.keyboard('{Escape}');
  await waitFor(() => assert.equal(menu(), null));
  await detailHeading(issuePane(), titles.issue, 3);
  await user.click(more);
  await user.click(issuePane());
  await waitFor(() => assert.equal(menu(), null));
});

test('a failed action shows the forge text under the buttons with Retry until dismissed or the next refresh', async () => {
  const forge: Forge = { issue: issueDetail(3) };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  (await action(1)).answer(failure(`HTTP 502: Server Error (${testForgeUrl}/graphql)`));
  const alert = await within(issuePane()).findByRole('alert');
  assert.deepEqual(descriptionParts(within(alert).getByRole('button', { name: t('retry') })), [
    t('actionFailed', {
      action: t('closeAsCompleted'),
      reason: `HTTP 502: Server Error (${testForgeUrl}/graphql)`,
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
  const notInstalled: ForgeFailure = { kind: 'notInstalled', detail: '', forge: testForge };
  (await missing.action(1)).answer({ ok: false, failure: notInstalled });
  await waitFor(() => assert.deepEqual(alertMessages(), [t('forgeCliMissing', { cli: testForge.cli })]));
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
    failure: { kind: 'loggedOut', detail: 'HTTP 401: Bad credentials', forge: testForge },
  });
  await within(forgeSidebar()).findByRole('button', { name: t('copyCommand', { command: testForge.loginCommand }) });
});

test('an action answered after the detail moved to another item shows nothing on that item', async () => {
  const link = { href: `${repositoryUrl}/pull/12`, text: '#12' };
  const forge: Forge = {
    issue: issueDetail(3, { body: `<p>Fixed by <a href="${link.href}">${link.text}</a>.</p>` }),
    pullRequest: pullDetail(12),
  };
  const { user, action } = await openIssue(forge);
  await user.click(within(issuePane()).getByRole('button', { name: t('closeIssue') }));
  const stale = await action(1);
  await user.click(within(issuePane()).getByRole('link', { name: link.text }));
  await detailHeading(pullPane(), titles.pullRequest, 12);
  stale.answer({ ok: false, failure: { kind: 'notInstalled', detail: '', forge: testForge } });
  await user.click(within(pullPane()).getByRole('button', { name: t('closePullRequest') }));
  (await action(2)).answer(failure('Server busy'));
  const alert = await within(pullPane()).findByRole('alert');
  assert.deepEqual(descriptionParts(within(alert).getByRole('button', { name: t('retry') })), [
    t('actionFailed', { action: t('closePullRequest'), reason: 'Server busy' }),
  ]);
  assert.equal(within(forgeSidebar()).getAllByRole('alert').length, 1, 'the earlier item leaves no failure');
});

test('with no write access to the repository, a detail shows no action buttons', async () => {
  const forge: Forge = { issue: issueDetail(3, { canWrite: false }), pullRequest: pullDetail(12, { canWrite: false }) };
  await openIssue(forge);
  assert.equal(within(issuePane()).queryByRole('button', { name: t('closeIssue') }), null);
  cleanup();
  await openPullRequest(forge);
  assert.deepEqual(mergeButtons(), []);
});

test('when a refresh grants or revokes write access, the open pull request detail shows or hides its action buttons', async () => {
  const forge: Forge = { pullRequest: pullDetail(12) };
  const { user } = await openPullRequest(forge);
  const allActions = [t('mergeMethodMerge'), t('chooseMergeMethod'), t('closePullRequest')];
  const actionButtons = () => allActions.filter(name => within(pullPane()).queryByRole('button', { name }) !== null);
  assert.deepEqual(actionButtons(), allActions);

  forge.pullRequest = pullDetail(12, { canWrite: false });
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('refresh') }));
  await waitFor(() => assert.deepEqual(actionButtons(), [], 'revoking write access hides the buttons'));
  await detailHeading(pullPane(), titles.pullRequest, 12);

  forge.pullRequest = pullDetail(12);
  await user.click(within(forgeSidebar()).getByRole('button', { name: t('refresh') }));
  await waitFor(() => assert.deepEqual(actionButtons(), allActions, 'granting write access shows the buttons'));
  await detailHeading(pullPane(), titles.pullRequest, 12);
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
