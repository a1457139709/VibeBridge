import test from 'node:test';
import assert from 'node:assert/strict';
import { presentOtherRelations } from '../app/renderer/forge/other-relations';
import type { IssueReference } from '../app/shared/forge/forge';

const issue = (number: number, extra: Partial<IssueReference> = {}): IssueReference => ({
  number,
  title: `Issue ${number}`,
  state: 'open',
  closedAs: null,
  url: `https://forge.test/ada/alpha/issues/${number}`,
  ...extra,
});
const closed = (number: number) => issue(number, { state: 'closed', closedAs: 'completed' });
const elsewhere = (number: number) => issue(number, { url: `https://forge.test/ada/other/issues/${number}` });

test('other blockers list every blocker, closed ones included, and count the unresolved ones', () => {
  const shown = presentOtherRelations(
    { blockedBy: [issue(2), closed(3), elsewhere(4)], blocking: [closed(8), issue(9)] },
    { siblings: null, blocking: true },
  );
  assert.deepEqual(shown, {
    blockers: { issues: [issue(2), closed(3), elsewhere(4)], unresolved: 2 },
    unblocks: [closed(8), issue(9)],
  });
});

test('every blocker closed leaves no unresolved ones', () => {
  const shown = presentOtherRelations({ blockedBy: [closed(3)], blocking: [] }, { siblings: null, blocking: true });
  assert.deepEqual(shown.blockers, { issues: [closed(3)], unresolved: 0 });
});

test('with no blockers or no issues it blocks, that row is absent', () => {
  assert.deepEqual(presentOtherRelations({ blockedBy: [], blocking: [] }, { siblings: null, blocking: true }), {
    blockers: null,
    unblocks: null,
  });
});

test('issues already in the shown sibling list are left out, and a row left empty is absent', () => {
  const shown = presentOtherRelations(
    { blockedBy: [issue(4), elsewhere(6)], blocking: [issue(6)] },
    { siblings: [issue(4), issue(5), issue(6)], blocking: true },
  );
  assert.deepEqual(shown, { blockers: { issues: [elsewhere(6)], unresolved: 1 }, unblocks: null });
});

test('a forge without blocking has neither row', () => {
  assert.deepEqual(
    presentOtherRelations({ blockedBy: [issue(2)], blocking: [issue(8)] }, { siblings: null, blocking: false }),
    { blockers: null, unblocks: null },
  );
});
