import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IssueLists, unfiltered } from '../../app/renderer/IssueLists';
import { platformDescriptions, type IssueSummary, type SubIssuesResult } from '../../app/shared/code-hosting';
import type { ProjectView } from '../../app/shared/model';
import { defaultWorkflowSettings } from '../../app/shared/workflows';
import { defaultShortcuts } from '../../app/shared/shortcuts';

afterEach(cleanup);

const issue = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [], moreBlockers: 0, ...extra });
const closed = (number: number, extra: Partial<IssueSummary> = {}) => issue(number, { state: 'closed', closedAs: 'completed', ...extra });

/** The issue list of octo/app showing one page of these issues; an issue's sub-issues are read from `subIssues`, as the platform answers. */
async function renderList(issues: IssueSummary[], subIssues: (number: number) => Promise<SubIssuesResult> = async () => ({ ok: true, issues: [] })) {
  const reads: number[] = [];
  const project: ProjectView = { id: 'app', name: 'App', directory: '/work/app', layout: null, panels: [], tray: [], dispatches: [], repository: { platform: 'github', path: 'octo/app' } };
  render(<IssueLists project={project} repository={project.repository!} workflows={defaultWorkflowSettings()} shortcuts={defaultShortcuts()} changeBinding={() => {}} filters={unfiltered} setFilters={() => {}} refreshed={() => {}} locate={() => {}} filled={() => {}} detail={{ open() {} }} mergeRequestDetail={{ open() {} }}
    api={{ issuePage: async () => ({ ok: true, page: { issues, next: null, labels: [] } }), mergeRequestPage: () => new Promise(() => {}), dispatch: async () => null,
      subIssues: (_projectId, number) => { reads.push(number); return subIssues(number); } }} />);
  const list = await screen.findByRole('list', { name: 'GitHub' });
  /** The labels of the rows directly in a list, in order. */
  const rows = (parent: HTMLElement = list) => [...parent.children].filter(child => child.tagName === 'LI').map(row => row.getAttribute('aria-label'));
  const row = (label: string) => screen.getByRole('listitem', { name: label });
  return { user: userEvent.setup(), list, rows, row, reads };
}

test('only issues without a listed parent sit at the top level, and sub-issues start collapsed behind a progress button', async () => {
  const children = [issue(14, { parent: 10 }), closed(11, { parent: 10 }), issue(12, { parent: 10, labels: [{ name: 'bug', color: 'd73a4a' }] }), closed(13, { parent: 10 })];
  const { user, rows, row, reads } = await renderList([
    issue(20, { parent: 99 }), children[0], issue(10, { subIssues: { completed: 2, total: 4 } }), issue(5),
  ], async () => ({ ok: true, issues: children }));
  assert.deepEqual(rows(), ['#20 Issue 20', '#10 Issue 10', '#5 Issue 5'], 'a listed sub-issue moves under its parent; one whose parent is not listed stays on top');

  const progress = within(row('#10 Issue 10')).getByRole('button', { name: 'Sub-issues: 2 of 4 closed' });
  assert.equal(progress.getAttribute('aria-expanded'), 'false');
  assert.ok(within(progress).getByText('2/4'));
  assert.equal(within(row('#5 Issue 5')).queryByRole('button', { name: /^Sub-issues/ }), null);

  assert.deepEqual(reads, [], 'sub-issues are read only when shown');
  await user.click(progress);
  assert.equal(progress.getAttribute('aria-expanded'), 'true');
  const subIssues = await within(row('#10 Issue 10')).findByRole('list', { name: 'Sub-issues of #10' });
  assert.deepEqual(reads, [10]);
  assert.deepEqual(rows(subIssues), ['#12 Issue 12', '#14 Issue 14'], 'open sub-issues in number order');
  assert.ok(within(row('#12 Issue 12')).getByText('bug'), 'a sub-issue keeps its full row');
  assert.ok(row('#12 Issue 12').querySelector('.issue-row-actions'));

  await user.click(within(row('#10 Issue 10')).getByRole('button', { name: '2 closed' }));
  assert.deepEqual(rows(subIssues), ['#11 Issue 11', '#12 Issue 12', '#13 Issue 13', '#14 Issue 14']);
  await user.click(within(row('#10 Issue 10')).getByRole('button', { name: 'Hide closed' }));
  assert.deepEqual(rows(subIssues), ['#12 Issue 12', '#14 Issue 14']);

  await user.click(progress);
  await waitFor(() => assert.equal(within(row('#10 Issue 10')).queryByRole('list'), null));
});

test('a sub-issue with sub-issues of its own expands too, however deep, each level read when it opens', async () => {
  const { user, row, reads } = await renderList([issue(1, { subIssues: { completed: 0, total: 1 } })], async number => ({ ok: true,
    issues: number === 1 ? [issue(2, { parent: 1, subIssues: { completed: 0, total: 1 } })] : number === 2 ? [issue(3, { parent: 2, subIssues: { completed: 1, total: 1 } })]
      : [closed(4, { parent: 3 })] }));
  for (const number of [1, 2, 3]) {
    await user.click(within(row(`#${number} Issue ${number}`)).getAllByRole('button', { name: /^Sub-issues/ })[0]);
    await within(row(`#${number} Issue ${number}`)).findByRole('list', { name: `Sub-issues of #${number}` });
  }
  await user.click(within(row('#3 Issue 3')).getByRole('button', { name: '1 closed' }));
  assert.ok(row('#4 Issue 4'));
  assert.deepEqual(reads, [1, 2, 3]);
});

test('sub-issues that cannot be read say why in place and read again on retry', async () => {
  let fail = true;
  const { user, row, reads } = await renderList([issue(1, { subIssues: { completed: 0, total: 1 } })], async () => fail
    ? { ok: false, failure: { kind: 'transient', platform: platformDescriptions.github, output: 'timeout' } } : { ok: true, issues: [issue(2, { parent: 1 })] });
  await user.click(within(row('#1 Issue 1')).getByRole('button', { name: /^Sub-issues/ }));
  const alert = await within(row('#1 Issue 1')).findByRole('alert');
  assert.match(alert.textContent ?? '', /timeout/);
  fail = false;
  await user.click(within(alert).getByRole('button', { name: 'Retry' }));
  await within(row('#1 Issue 1')).findByRole('list', { name: 'Sub-issues of #1' });
  assert.ok(row('#2 Issue 2'));
  assert.deepEqual(reads, [1, 1]);
});

test('a blocked issue shows its blockers by number, names them on hover and keeps its actions', async () => {
  const { row } = await renderList([
    issue(150, { blockedBy: [{ number: 143, title: 'Storage schema' }, { number: 142, title: 'Platform interface' }] }), issue(149),
  ]);
  const mark = within(row('#150 Issue 150')).getByRole('img', { name: 'Blocked by #143, #142' });
  assert.ok(within(mark).getByText('#143, #142'));
  assert.equal(mark.getAttribute('title'), '#143 Storage schema\n#142 Platform interface');
  assert.ok(row('#150 Issue 150').querySelector('.issue-row-actions'), 'a blocked issue can still be dispatched');
  assert.equal(within(row('#149 Issue 149')).queryByRole('img', { name: /^Blocked/ }), null);
});

test('open blockers the list did not name still mark the issue blocked, counted after the named ones', async () => {
  const { row } = await renderList([issue(150, { blockedBy: [{ number: 143, title: 'Storage schema' }], moreBlockers: 3 }), issue(149, { moreBlockers: 2 })]);
  const named = within(row('#150 Issue 150')).getByRole('img', { name: 'Blocked by #143, +3' });
  assert.equal(named.getAttribute('title'), '#143 Storage schema\n3 more; open the issue to see them all');
  assert.ok(within(row('#149 Issue 149')).getByRole('img', { name: 'Blocked by +2' }), 'blocked only by blockers the list did not name');
});

test('a platform that does not declare sub-issues or native blocking shows neither the tree nor blocking marks', async context => {
  const declared = platformDescriptions.github.capabilities;
  platformDescriptions.github.capabilities = declared.filter(capability => capability !== 'subIssues' && capability !== 'nativeBlocking');
  context.after(() => { platformDescriptions.github.capabilities = declared; });
  const { rows, row } = await renderList([
    issue(3, { parent: 1, blockedBy: [{ number: 2, title: 'Blocker' }] }), issue(1, { subIssues: { completed: 0, total: 1 } }),
  ]);
  assert.deepEqual(rows(), ['#3 Issue 3', '#1 Issue 1']);
  assert.equal(within(row('#1 Issue 1')).queryByRole('button', { name: /^Sub-issues/ }), null);
  assert.equal(within(row('#3 Issue 3')).queryByRole('img', { name: /^Blocked/ }), null);
});
