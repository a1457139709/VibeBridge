import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { testForge, testForgeCapabilitiesWith, testForgeUrl } from './support/forge';
import { descriptionParts } from './support/elements';
import { nameIncluding } from './support/accessible-names';
import type { ForgeCapabilities, IssueDetail, PullRequestReference } from '../../app/shared/forge/forge';
import type { RelationRowName } from '../../app/renderer/forge/OtherRelations';
import {
  detail,
  pane,
  reference,
  related,
  renderWorkbench,
  repositoryUrl,
  row,
  subIssue,
  summary,
} from './support/issue-detail';
import { detailHeading } from './support/sidebar-queries';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

async function openIssue(issue: IssueDetail, capabilities: Partial<ForgeCapabilities> = {}) {
  const shown = renderWorkbench([summary(issue.number)], testForgeCapabilitiesWith(capabilities));
  await shown.user.click(await row(`Issue ${issue.number}`));
  (await shown.request(1)).answer({ ok: true, issue });
  await detailHeading(pane(), issue.title, issue.number);
  return shown;
}
const otherRelations = () => within(pane()).getByRole('region', { name: t('otherRelations') });
const relationRow = (id: RelationRowName) => within(otherRelations()).queryByRole('group', { name: t(id) });
const shownRow = (id: RelationRowName) => {
  const found = relationRow(id);
  assert.ok(found, `the ${id} row is shown`);
  return found;
};
const closed = { state: 'closed', closedAs: 'completed' } as const;
const elsewhere = (number: number, title: string) =>
  related(number, { title, url: `${testForgeUrl}/ada/other/issues/${number}`, path: 'ada/other' });

test('other relations list every blocker and every issue this one blocks, closed ones included, and say how many blockers are unresolved', async () => {
  const { user, request } = await openIssue(
    detail(5, {
      title: 'Detail',
      blockedBy: [
        related(2, { title: 'Open blocker' }),
        related(3, { title: 'Closed blocker', ...closed }),
        elsewhere(4, 'Blocker elsewhere'),
      ],
      blocking: [related(8, { title: 'Waits on detail' }), related(9, { title: 'Done after detail', ...closed })],
    }),
  );
  const blockers = shownRow('otherBlockers');
  assert.deepEqual(descriptionParts(blockers), [t('unresolvedBlockers', { count: 2 })]);
  assert.equal(within(blockers).getAllByRole('button').length, 2, 'blockers of this repository open in the sidebar');
  assert.equal(
    within(blockers)
      .getByRole('link', { name: nameIncluding('Blocker elsewhere') })
      .getAttribute('href'),
    `${testForgeUrl}/ada/other/issues/4`,
    'a blocker of another repository opens in the browser',
  );
  assert.ok(within(blockers).getByRole('button', { name: nameIncluding('Closed blocker') }));
  const unblocks = shownRow('unblocks');
  assert.equal(within(unblocks).getAllByRole('button').length, 2);
  assert.ok(within(unblocks).getByRole('button', { name: nameIncluding('Done after detail') }));
  assert.equal(
    within(pane()).queryByRole('img', { name: t('blockedBy', { issues: '#2' }) }),
    null,
    'the head carries no blocked mark',
  );

  await user.click(within(blockers).getByRole('button', { name: nameIncluding('Open blocker') }));
  assert.equal((await request(2)).number, 2);
});

test('a relation of another repository names that repository, and opens in the browser', async () => {
  await openIssue(
    detail(5, { blockedBy: [elsewhere(4, 'Blocker elsewhere')], blocking: [elsewhere(7, 'Waits elsewhere')] }),
  );
  for (const [row, title] of [
    ['otherBlockers', 'Blocker elsewhere'],
    ['unblocks', 'Waits elsewhere'],
  ] as const) {
    const chip = within(shownRow(row)).getByRole('link', { name: nameIncluding(title) });
    assert.ok(chip.getAttribute('aria-label')?.includes('ada/other'), 'its accessible name holds the repository');
    assert.ok(chip.textContent?.startsWith('other#'), 'it shows the repository name before the number');
  }
});

test('blockers and blocked issues past those the forge listed are counted from its totals, with a link to the issue on the forge', async () => {
  const listedBlockers = [related(2), related(3)];
  await openIssue(
    detail(5, { blockedBy: listedBlockers, blockedByTotal: 60, blocking: [related(8)], blockingTotal: 51 }),
  );
  for (const [row, count] of [
    ['otherBlockers', 58],
    ['unblocks', 50],
  ] as const) {
    assert.equal(
      within(shownRow(row))
        .getByRole('link', { name: t('moreRelations', { count, forge: testForge.name }) })
        .getAttribute('href'),
      `${repositoryUrl}/issues/5`,
    );
  }
});

test('blockers that are all closed read as all resolved', async () => {
  await openIssue(detail(5, { blockedBy: [related(3, closed)] }));
  assert.deepEqual(descriptionParts(shownRow('otherBlockers')), [t('blockersResolved')]);
});

test('an issue with no blockers and none it blocks still shows the pull request row, saying there is none', async () => {
  await openIssue(detail(5));
  assert.equal(relationRow('otherBlockers'), null);
  assert.equal(relationRow('unblocks'), null);
  const pullRequests = shownRow('pullRequestAbbreviation');
  assert.deepEqual(descriptionParts(pullRequests), [t('noPullRequests')]);
  assert.equal(within(pullRequests).queryAllByRole('button').length, 0);
});

test("on a sub-issue's page, the relations already in the sibling list are left out, and a row left empty is not shown", async () => {
  const parent = {
    ...reference(1, { title: 'Spec' }),
    progress: { closed: 0, total: 3 },
    subIssues: [subIssue(4, { title: 'Model' }), subIssue(5, { title: 'View' }), subIssue(6, { title: 'Wiring' })],
  };
  await openIssue(
    detail(5, {
      title: 'View',
      parent,
      blockedBy: [related(4, { title: 'Model' }), elsewhere(4, 'Model elsewhere')],
      blocking: [related(6, { title: 'Wiring' })],
    }),
  );
  assert.equal(within(shownRow('otherBlockers')).getAllByRole('link').length, 1);
  assert.ok(within(shownRow('otherBlockers')).getByRole('link', { name: nameIncluding('Model elsewhere') }));
  assert.equal(within(shownRow('otherBlockers')).queryAllByRole('button').length, 0);
  assert.equal(relationRow('unblocks'), null);
});

test('an issue that lists its own sub-issues keeps every relation, though it has a parent', async () => {
  const parent = {
    ...reference(1, { title: 'Spec' }),
    progress: { closed: 0, total: 2 },
    subIssues: [subIssue(4, { title: 'Model' }), subIssue(5, { title: 'View' })],
  };
  await openIssue(
    detail(5, {
      title: 'View',
      parent,
      subIssues: [subIssue(7)],
      subIssueProgress: { closed: 0, total: 1 },
      blockedBy: [related(4, { title: 'Model' })],
    }),
  );
  assert.equal(within(shownRow('otherBlockers')).getAllByRole('button').length, 1);
});

test('a forge without blocking shows neither blocker row, but still the pull request row', async () => {
  await openIssue(detail(5, { blockedBy: [related(2)], blocking: [related(8)] }), { blocking: false });
  assert.equal(relationRow('otherBlockers'), null);
  assert.equal(relationRow('unblocks'), null);
  assert.ok(shownRow('pullRequestAbbreviation'));
});

test('the pull request row lists every pull request that closes the issue on merge, each with its state and checks conclusion', async () => {
  const pull = (
    number: number,
    title: string,
    state: PullRequestReference['state'],
    checks: PullRequestReference['checks'],
  ): PullRequestReference => ({ number, title, state, checks, url: `${repositoryUrl}/pull/${number}` });
  const closing = [
    pull(40, 'Passing', 'open', 'passed'),
    pull(41, 'Running', 'draft', 'pending'),
    pull(42, 'Failing', 'open', 'failed'),
    pull(43, 'Merged', 'merged', 'passed'),
    pull(44, 'Abandoned', 'closed', 'failed'),
    pull(45, 'Unchecked', 'open', 'none'),
  ];
  await openIssue(detail(5, { closingPullRequests: closing }));
  const pullRequests = shownRow('pullRequestAbbreviation');
  const chips = within(pullRequests).getAllByRole('button');
  assert.deepEqual(
    chips,
    closing.map(({ title }) => within(pullRequests).getByRole('button', { name: nameIncluding(title) })),
    'each, of the bound repository, opens in the sidebar, in order',
  );
  assert.deepEqual(
    chips.map(chip =>
      within(chip)
        .getAllByRole('img')
        .map(image => image.getAttribute('aria-label')),
    ),
    [
      [t('pullRequestOpen'), t('checksPassed')],
      [t('pullRequestDraft'), t('checksPending')],
      [t('pullRequestOpen'), t('checksFailed')],
      [t('pullRequestMerged')],
      [t('pullRequestClosed')],
      [t('pullRequestOpen')],
    ],
    'each names its state, and an open one its checks conclusion',
  );
  assert.deepEqual(descriptionParts(pullRequests), []);
});
