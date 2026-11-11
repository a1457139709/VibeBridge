import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IssueLists, unfiltered } from '../../app/renderer/IssueLists';
import { platformDescriptions, type IssueSummary } from '../../app/shared/code-hosting';
import type { ProjectView } from '../../app/shared/model';
import { defaultWorkflowSettings } from '../../app/shared/workflows';
import { defaultShortcuts } from '../../app/shared/shortcuts';

afterEach(cleanup);

const issue = (number: number, extra: Partial<IssueSummary> = {}): IssueSummary => ({ number, title: `Issue ${number}`, state: 'open', closedAs: null,
  createdAt: '2026-11-01T00:00:00Z', labels: [], url: `https://github.com/octo/app/issues/${number}`, parent: null, subIssues: null, blockedBy: [], ...extra });
const closed = (number: number, extra: Partial<IssueSummary> = {}) => issue(number, { state: 'closed', closedAs: 'completed', ...extra });

/** The issue list of octo/app showing one page of these issues. */
async function renderList(issues: IssueSummary[]) {
  const project: ProjectView = { id: 'app', name: 'App', directory: '/work/app', layout: null, panels: [], tray: [], dispatches: [], repository: { platform: 'github', path: 'octo/app' } };
  render(<IssueLists project={project} repository={project.repository!} workflows={defaultWorkflowSettings()} shortcuts={defaultShortcuts()} changeBinding={() => {}} filters={unfiltered} setFilters={() => {}} refreshed={() => {}} locate={() => {}} filled={() => {}} detail={{ open() {} }} mergeRequestDetail={{ open() {} }}
    api={{ issuePage: async () => ({ ok: true, page: { issues, next: null, labels: [] } }), mergeRequestPage: () => new Promise(() => {}), dispatch: async () => null }} />);
  const list = await screen.findByRole('list', { name: 'GitHub' });
  /** The labels of the rows directly in a list, in order. */
  const rows = (parent: HTMLElement = list) => [...parent.children].filter(child => child.tagName === 'LI').map(row => row.getAttribute('aria-label'));
  const row = (label: string) => screen.getByRole('listitem', { name: label });
  return { user: userEvent.setup(), list, rows, row };
}

test('only issues without a listed parent sit at the top level, and sub-issues start collapsed behind a progress button', async () => {
  const children = [issue(14, { parent: 10 }), closed(11, { parent: 10 }), issue(12, { parent: 10, labels: [{ name: 'bug', color: 'd73a4a' }] }), closed(13, { parent: 10 })];
  const { user, rows, row } = await renderList([
    issue(20, { parent: 99 }), children[0], issue(10, { subIssues: { completed: 2, total: 4, issues: children } }), issue(5),
  ]);
  assert.deepEqual(rows(), ['#20 Issue 20', '#10 Issue 10', '#5 Issue 5'], 'a listed sub-issue moves under its parent; one whose parent is not listed stays on top');

  const progress = within(row('#10 Issue 10')).getByRole('button', { name: 'Sub-issues: 2 of 4 closed' });
  assert.equal(progress.getAttribute('aria-expanded'), 'false');
  assert.ok(within(progress).getByText('2/4'));
  assert.equal(within(row('#5 Issue 5')).queryByRole('button', { name: /^Sub-issues/ }), null);

  await user.click(progress);
  assert.equal(progress.getAttribute('aria-expanded'), 'true');
  const subIssues = within(row('#10 Issue 10')).getByRole('list', { name: 'Sub-issues of #10' });
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

test('a platform that does not declare sub-issues or native blocking shows neither the tree nor blocking marks', async context => {
  const declared = platformDescriptions.github.capabilities;
  platformDescriptions.github.capabilities = declared.filter(capability => capability !== 'subIssues' && capability !== 'nativeBlocking');
  context.after(() => { platformDescriptions.github.capabilities = declared; });
  const { rows, row } = await renderList([
    issue(3, { parent: 1, blockedBy: [{ number: 2, title: 'Blocker' }] }), issue(1, { subIssues: { completed: 0, total: 1, issues: [issue(3, { parent: 1 })] } }),
  ]);
  assert.deepEqual(rows(), ['#3 Issue 3', '#1 Issue 1']);
  assert.equal(within(row('#1 Issue 1')).queryByRole('button', { name: /^Sub-issues/ }), null);
  assert.equal(within(row('#3 Issue 3')).queryByRole('img', { name: /^Blocked/ }), null);
});
