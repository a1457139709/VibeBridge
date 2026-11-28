import test from 'node:test';
import assert from 'node:assert/strict';
import { presentSubIssueRows, subIssueKey } from '../app/renderer/forge/sub-issue-rows';
import type { RelatedBlocker, SubIssue } from '../app/shared/forge/forge';

const blocker = (number: number, extra: Partial<RelatedBlocker> = {}): RelatedBlocker => ({
  path: null,
  number,
  title: `Issue ${number}`,
  state: 'open',
  ...extra,
});
const sub = (number: number, extra: Partial<SubIssue> = {}): SubIssue => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  url: `https://forge.test/ada/alpha/issues/${number}`,
  path: null,
  blockedBy: [],
  unlistedBlockers: 0,
  ...extra,
});
const subIssues = [
  sub(1),
  sub(2, { blockedBy: [blocker(1), blocker(3, { state: 'closed' })] }),
  sub(3, { state: 'closed', closedAs: 'completed' }),
  sub(4, { blockedBy: [blocker(2)] }),
  sub(5, { blockedBy: [blocker(2, { path: 'ada/other' })] }),
];
const relations = (lit: number | null, blocking = true) =>
  presentSubIssueRows(subIssues, {
    lit: lit === null ? null : subIssueKey(sub(lit)),
    current: null,
    blocking,
  }).map(row => [row.issue.number, row.relation]);

test('with no row lit, no row carries a relation', () => {
  assert.deepEqual(relations(null), [
    [1, null],
    [2, null],
    [3, null],
    [4, null],
    [5, null],
  ]);
});

test("a lit row's direct blockers in the list block it, the rows it blocks are blocked by it, and the rest are unrelated", () => {
  assert.deepEqual(relations(2), [
    [1, 'blocksLit'],
    [2, 'lit'],
    [3, 'blocksLit'],
    [4, 'blockedByLit'],
    [5, 'unrelated'],
  ]);
});

test('only direct relations light up, and a blocker in another repository with the same number lights nothing', () => {
  assert.deepEqual(relations(1), [
    [1, 'lit'],
    [2, 'blockedByLit'],
    [3, 'unrelated'],
    [4, 'unrelated'],
    [5, 'unrelated'],
  ]);
});

test('an open row blocked by an open issue carries its open blockers, and a closed row carries none', () => {
  const rows = presentSubIssueRows(
    [
      sub(1, { blockedBy: [blocker(7), blocker(8, { state: 'closed' })], unlistedBlockers: 2 }),
      sub(2, { state: 'closed', closedAs: 'completed', blockedBy: [blocker(7)] }),
      sub(3, { blockedBy: [blocker(8, { state: 'closed' })] }),
    ],
    { lit: null, current: null, blocking: true },
  );
  assert.deepEqual(
    rows.map(row => [row.issue.number, row.openBlockers.map(open => open.number), row.unlistedBlockers]),
    [
      [1, [7], 2],
      [2, [], 0],
      [3, [], 0],
    ],
  );
});

test('a forge without blocking lights no relation and marks no row blocked', () => {
  assert.deepEqual(relations(2, false), [
    [1, null],
    [2, null],
    [3, null],
    [4, null],
    [5, null],
  ]);
  const [blocked] = presentSubIssueRows([sub(1, { blockedBy: [blocker(7)], unlistedBlockers: 1 })], {
    lit: null,
    current: null,
    blocking: false,
  });
  assert.deepEqual([blocked.openBlockers, blocked.unlistedBlockers], [[], 0]);
});

test('only open rows of this repository other than the current issue can be dispatched', () => {
  const rows = presentSubIssueRows(subIssues, { lit: null, current: subIssueKey(sub(4)), blocking: true });
  assert.deepEqual(
    rows.map(row => [row.issue.number, row.dispatchable]),
    [
      [1, true],
      [2, true],
      [3, false],
      [4, false],
      [5, true],
    ],
  );
  const [outside] = presentSubIssueRows([sub(6, { path: 'ada/other' })], { lit: null, current: null, blocking: true });
  assert.equal(outside.dispatchable, false);
});
