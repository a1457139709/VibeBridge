import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, before } from 'node:test';
import { cleanup, waitFor, within } from '@testing-library/react';
import { t } from './support/localization';
import { stubLayoutApis } from './support/no-layout';
import { testForgeCapabilitiesWith } from './support/forge';
import { descriptionParts } from './support/elements';
import { nameIncluding } from './support/accessible-names';
import type { ForgeCapabilities, IssueDetail, RelatedBlocker } from '../../app/shared/forge/forge';
import { detail, pane, reference, renderWorkbench, row, subIssue, summary } from './support/issue-detail';
import { detailHeading } from './support/sidebar-queries';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const blocker = (number: number, title: string): RelatedBlocker => ({ path: null, number, title, state: 'open' });

const parent = {
  ...reference(1, { title: 'Spec' }),
  progress: { closed: 1, total: 4 },
  subIssues: [
    subIssue(4, { title: 'Model' }),
    subIssue(5, { title: 'View', blockedBy: [blocker(4, 'Model')] }),
    subIssue(6, { title: 'Wiring', blockedBy: [blocker(5, 'View')] }),
    subIssue(7, { title: 'Docs', state: 'closed', closedAs: 'completed' }),
  ],
};
const child = (extra: Partial<IssueDetail> = {}) => detail(5, { title: 'View', parent, ...extra });

async function openChild(issue: IssueDetail, capabilities: Partial<ForgeCapabilities> = {}) {
  const shown = renderWorkbench([summary(5)], testForgeCapabilitiesWith(capabilities));
  await shown.user.click(await row('Issue 5'));
  (await shown.request(1)).answer({ ok: true, issue });
  await detailHeading(pane(), issue.title, issue.number);
  return shown;
}
const siblings = () => within(pane()).getByRole('region', { name: t('siblingIssues') });
const siblingRow = (title: string) => within(siblings()).getByRole('button', { name: nameIncluding(title) });
const rowTitles = ['Model', 'View', 'Wiring', 'Docs'];
const relations = () => rowTitles.map(title => descriptionParts(siblingRow(title)));

test("a sub-issue's page lists its siblings under its parent, whose heading opens the parent, and links the parent nowhere else", async () => {
  const { user, request } = await openChild(child());
  assert.ok(within(siblings()).getByRole('img', { name: t('subIssueProgress', { closed: 1, total: 4 }) }));
  assert.equal(
    within(siblings())
      .getByRole('button', { name: t('siblingIssues') })
      .getAttribute('aria-expanded'),
    'true',
  );
  assert.deepEqual(
    within(pane())
      .getAllByRole('button', { name: nameIncluding('Spec') })
      .map(button => siblings().contains(button)),
    [true],
    'the parent is linked only from the sibling list',
  );
  await user.click(within(siblings()).getByRole('button', { name: nameIncluding('Spec') }));
  assert.equal((await request(2)).number, 1);
});

test('the sibling list marks this issue and its direct blocking relations until another row is pointed at', async () => {
  const { user } = await openChild(child());
  const ownRelations = [
    [t('subIssueBlocksLit')],
    [t('subIssueLit')],
    [t('subIssueBlockedByLit')],
    [t('subIssueUnrelated')],
  ];
  assert.deepEqual(relations(), ownRelations);
  await user.hover(siblingRow('Wiring'));
  await waitFor(() =>
    assert.deepEqual(relations(), [
      [t('subIssueUnrelated')],
      [t('subIssueBlocksLit')],
      [t('subIssueLit')],
      [t('subIssueUnrelated')],
    ]),
  );
  await user.unhover(siblings());
  await waitFor(() => assert.deepEqual(relations(), ownRelations));
});

test('an issue with sub-issues of its own lists those instead of its siblings', async () => {
  await openChild(child({ subIssues: [subIssue(8, { title: 'Part' })], subIssueProgress: { closed: 0, total: 1 } }));
  assert.ok(within(pane()).getByRole('region', { name: t('subIssues') }));
  assert.equal(within(pane()).queryByRole('region', { name: t('siblingIssues') }), null);
});

test('a forge without sub-issues shows no sibling list', async () => {
  await openChild(child(), { subIssues: false });
  assert.equal(within(pane()).queryByRole('region', { name: t('siblingIssues') }), null);
  assert.equal(within(pane()).queryByRole('button', { name: nameIncluding('Spec') }), null);
});
