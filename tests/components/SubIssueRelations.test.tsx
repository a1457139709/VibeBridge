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
import { detail, pane, renderWorkbench, row, subIssue, summary } from './support/issue-detail';
import { detailHeading } from './support/sidebar-queries';

afterEach(cleanup);
before(() => {
  stubLayoutApis();
  for (const target of [globalThis, window]) Object.assign(target, { KeyframeEffect: class {} });
  window.HTMLElement.prototype.checkVisibility = () => true;
});

const blocker = (number: number, extra: Partial<RelatedBlocker> = {}): RelatedBlocker => ({
  path: null,
  number,
  title: `Issue ${number}`,
  state: 'open',
  ...extra,
});

const spec = (extra: Partial<IssueDetail> = {}) =>
  detail(5, {
    title: 'Spec',
    body: '<p>The spec body.</p>',
    subIssues: [
      subIssue(8, { title: 'Model' }),
      subIssue(6, { title: 'View', blockedBy: [blocker(8, { title: 'Model' })] }),
      subIssue(7, { title: 'Docs', state: 'closed', closedAs: 'completed' }),
      subIssue(9, {
        title: 'Wiring',
        blockedBy: [blocker(6, { title: 'View' }), blocker(7, { title: 'Docs', state: 'closed' })],
      }),
      subIssue(10, { title: 'Release', blockedBy: [blocker(6, { path: 'ada/other', title: 'Elsewhere' })] }),
    ],
    subIssueProgress: { closed: 1, total: 5 },
    ...extra,
  });

async function openSpec(issue: IssueDetail, capabilities: Partial<ForgeCapabilities> = {}) {
  const shown = renderWorkbench([summary(5)], testForgeCapabilitiesWith(capabilities));
  await shown.user.click(await row('Issue 5'));
  (await shown.request(1)).answer({ ok: true, issue });
  await detailHeading(pane(), issue.title, issue.number);
  return shown;
}
const subIssues = () => within(pane()).getByRole('region', { name: t('subIssues') });
const subIssueRow = (title: string) => within(subIssues()).getByRole('button', { name: nameIncluding(title) });
const rowTitles = ['Model', 'View', 'Docs', 'Wiring', 'Release'];
const relations = () => rowTitles.map(title => descriptionParts(subIssueRow(title)));
const listImages = () =>
  within(subIssues())
    .getAllByRole('img')
    .map(image => image.getAttribute('aria-label'));

test("a spec's sub-issues sit above its body in the forge's order, under the sub-issue progress, and none sit below it", async () => {
  await openSpec(spec());
  const [body] = within(pane()).getAllByRole('article');
  assert.ok(subIssues().compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING, 'the list is above the body');
  assert.equal(within(pane()).getAllByRole('region', { name: t('subIssues') }).length, 1);
  assert.ok(within(subIssues()).getByRole('img', { name: t('subIssueProgress', { closed: 1, total: 5 }) }));
  const rows = rowTitles.map(subIssueRow);
  assert.ok(
    rows.every(
      (current, index) => !index || rows[index - 1].compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING,
    ),
    "the rows follow the forge's order",
  );
});

test('hovering a row marks it, the rows that block it, the rows it blocks and the unrelated rows apart', async () => {
  const { user } = await openSpec(spec());
  assert.deepEqual(relations(), [[], [], [], [], []], 'nothing is marked before a row is pointed at');
  await user.hover(subIssueRow('View'));
  await waitFor(() =>
    assert.deepEqual(relations(), [
      [t('subIssueBlocksLit')],
      [t('subIssueLit')],
      [t('subIssueUnrelated')],
      [t('subIssueBlockedByLit')],
      [t('subIssueUnrelated')],
    ]),
  );
  await user.hover(subIssueRow('Docs'));
  await waitFor(() =>
    assert.deepEqual(relations(), [
      [t('subIssueUnrelated')],
      [t('subIssueUnrelated')],
      [t('subIssueLit')],
      [t('subIssueBlockedByLit')],
      [t('subIssueUnrelated')],
    ]),
  );
  await user.unhover(subIssues());
  await waitFor(() => assert.deepEqual(relations(), [[], [], [], [], []]));
});

test('only an open row blocked by an open issue carries a blocked mark, listing its open blockers', async () => {
  await openSpec(
    spec({
      subIssues: [
        subIssue(6, { title: 'View', blockedBy: [blocker(8, { title: 'Model' })], unlistedBlockers: 2 }),
        subIssue(7, { title: 'Docs', state: 'closed', closedAs: 'completed', blockedBy: [blocker(8)] }),
        subIssue(9, { title: 'Wiring', blockedBy: [blocker(7, { state: 'closed' })] }),
        subIssue(10, { title: 'Release', blockedBy: [blocker(3, { path: 'ada/other' })] }),
      ],
    }),
  );
  assert.deepEqual(listImages(), [
    t('subIssueProgress', { closed: 1, total: 5 }),
    t('blockedBy', { issues: `#8, ${t('moreBlockers', { count: 2 })}` }),
    t('blockedBy', { issues: 'ada/other#3' }),
  ]);
});

test("the sub-issue list folds, and a closed spec's list starts folded", async () => {
  const { user } = await openSpec(spec());
  const toggle = within(subIssues()).getByRole('button', { name: t('subIssues') });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  await user.click(toggle);
  await waitFor(() => assert.equal(toggle.getAttribute('aria-expanded'), 'false'));
  assert.equal(within(subIssues()).queryByRole('button', { name: nameIncluding('Model') }), null);
  cleanup();
  await openSpec(spec({ state: 'closed', closedAs: 'completed' }));
  assert.equal(
    within(subIssues())
      .getByRole('button', { name: t('subIssues') })
      .getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(within(subIssues()).queryByRole('button', { name: nameIncluding('Model') }), null);
});

test('clicking a row asks for that issue in the sidebar', async () => {
  const { user, request } = await openSpec(spec());
  await user.click(subIssueRow('Wiring'));
  assert.equal((await request(2)).number, 9);
});

test('a forge without sub-issues shows no list, and one without blocking marks no relation and no blocked row', async () => {
  await openSpec(spec(), { subIssues: false });
  assert.equal(within(pane()).queryByRole('region', { name: t('subIssues') }), null);
  cleanup();
  const { user } = await openSpec(spec(), { blocking: false });
  await user.hover(subIssueRow('View'));
  assert.deepEqual(relations(), [[], [], [], [], []]);
  assert.deepEqual(listImages(), [t('subIssueProgress', { closed: 1, total: 5 })]);
});
