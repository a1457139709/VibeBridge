import test from 'node:test';
import assert from 'node:assert/strict';
import { presentOtherRelations } from '../app/renderer/forge/other-relations';
import type { IssueDetail, RelatedIssue } from '../app/shared/forge/forge';

const issue = (number: number, extra: Partial<RelatedIssue> = {}): RelatedIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  url: `https://forge.test/ada/alpha/issues/${number}`,
  path: null,
  ...extra,
});
const closed = (number: number) => issue(number, { state: 'closed', closedAs: 'completed' });
const elsewhere = (number: number) =>
  issue(number, { url: `https://forge.test/ada/other/issues/${number}`, path: 'ada/other' });
const relations = (
  blockedBy: RelatedIssue[],
  blocking: RelatedIssue[],
  totals: Partial<Pick<IssueDetail, 'blockedByTotal' | 'blockingTotal'>> = {},
) => ({ blockedBy, blockedByTotal: blockedBy.length, blocking, blockingTotal: blocking.length, ...totals });

test('other blockers list every blocker, closed ones included, and count the unresolved ones', () => {
  const shown = presentOtherRelations(relations([issue(2), closed(3), elsewhere(4)], [closed(8), issue(9)]), {
    siblings: null,
    blocking: true,
  });
  assert.deepEqual(shown, {
    blockers: { issues: [issue(2), closed(3), elsewhere(4)], unresolved: 2, allResolved: false, unlisted: 0 },
    unblocks: { issues: [closed(8), issue(9)], unlisted: 0 },
  });
});

test('every blocker closed leaves no unresolved ones', () => {
  const shown = presentOtherRelations(relations([closed(3)], []), { siblings: null, blocking: true });
  assert.deepEqual(shown.blockers, { issues: [closed(3)], unresolved: 0, allResolved: true, unlisted: 0 });
});

test('with no blockers or no issues it blocks, that row is absent', () => {
  assert.deepEqual(presentOtherRelations(relations([], []), { siblings: null, blocking: true }), {
    blockers: null,
    unblocks: null,
  });
});

test('issues already in the shown sibling list are left out, and a row left empty is absent', () => {
  const shown = presentOtherRelations(relations([issue(4), elsewhere(6)], [issue(6)]), {
    siblings: [issue(4), issue(5), issue(6)],
    blocking: true,
  });
  assert.deepEqual(shown, {
    blockers: { issues: [elsewhere(6)], unresolved: 1, allResolved: false, unlisted: 0 },
    unblocks: null,
  });
});

test('relations past those the forge listed are counted from its totals, even when the sibling list holds every listed one, and blockers left unlisted are not called resolved', () => {
  const shown = presentOtherRelations(
    relations([issue(4)], [issue(6), issue(7)], { blockedByTotal: 3, blockingTotal: 52 }),
    { siblings: [issue(4), issue(6)], blocking: true },
  );
  assert.deepEqual(shown, {
    blockers: { issues: [], unresolved: 0, allResolved: false, unlisted: 2 },
    unblocks: { issues: [issue(7)], unlisted: 50 },
  });
});

test('a forge without blocking has neither row', () => {
  assert.deepEqual(presentOtherRelations(relations([issue(2)], [issue(8)]), { siblings: null, blocking: false }), {
    blockers: null,
    unblocks: null,
  });
});
