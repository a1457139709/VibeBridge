import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble, type GhPullRequest } from './support/gh-double';
import { interactiveWorkbench } from './support/interactive-workbench';
import type { ListFilter } from '../app/shared/forge';

const openNoFilter: ListFilter = { search: '', state: 'open', labels: [] };
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString();
const account = { account: 'octo', repositories: ['octo/tools'] };

async function boundWorkbench(scope: string) {
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Bound');
  await f.workbench.editProject(project.id, { name: 'Bound', directory: f.directory, repository: { forge: 'github', path: 'octo/tools' } }, false);
  return { ...f, projectId: project.id };
}

test('a refresh returns one page of 25 pull requests, newest first, and the cursor loads the rest', async context => {
  const thirty: GhPullRequest[] = Array.from({ length: 30 }, (_, index) => ({
    number: index + 1, title: `Change ${index + 1}`, state: 'OPEN', createdAt: day(index), author: 'octo', labels: [],
  }));
  await ghDouble(context, { ...account, pullRequests: thirty, issues: [{ number: 31, title: 'Not a change', state: 'OPEN', createdAt: day(40), labels: [] }] });
  const f = await boundWorkbench('pull-request-page');
  try {
    const first = await f.workbench.pullRequestPage(f.projectId, { filter: openNoFilter, cursor: null });
    assert.ok(first.ok);
    assert.deepEqual(first.items.map(item => item.number), Array.from({ length: 25 }, (_, index) => 30 - index), 'issues are not listed');
    assert.deepEqual(first.items[0], { number: 30, title: 'Change 30', state: 'open', createdAt: day(29), author: 'octo', checks: 'none', labels: [] });
    assert.ok(first.cursor);
    const rest = await f.workbench.pullRequestPage(f.projectId, { filter: openNoFilter, cursor: first.cursor });
    assert.ok(rest.ok);
    assert.deepEqual(rest.items.map(item => item.number), [5, 4, 3, 2, 1]);
    assert.equal(rest.cursor, null, 'the last page has no cursor');
  } finally { await f.close(); }
});

test('a pull request is open, draft, merged or closed with its checks conclusion, and Closed lists merged ones too', async context => {
  const bug = { name: 'bug', color: 'd73a4a' }, docs = { name: 'docs', color: '0075ca' };
  await ghDouble(context, { ...account, labels: [bug, docs], pullRequests: [
    { number: 1, title: 'Fix sidebar refresh', state: 'OPEN', createdAt: day(1), author: 'octo', labels: [bug], checks: 'SUCCESS' },
    { number: 2, title: 'Draft tray order', state: 'OPEN', isDraft: true, createdAt: day(2), author: 'mona', labels: [], checks: 'PENDING' },
    { number: 3, title: 'Sidebar width', state: 'MERGED', createdAt: day(3), author: 'octo', labels: [bug, docs], checks: 'FAILURE' },
    { number: 4, title: 'Dropped idea', state: 'CLOSED', createdAt: day(4), author: null, labels: [], checks: 'ERROR' },
    { number: 12, title: 'Expected check', state: 'OPEN', createdAt: day(5), author: 'octo', labels: [], checks: 'EXPECTED' },
  ] });
  const f = await boundWorkbench('pull-request-filters');
  try {
    const list = async (filter: Partial<ListFilter>) => {
      const page = await f.workbench.pullRequestPage(f.projectId, { filter: { ...openNoFilter, ...filter }, cursor: null });
      assert.ok(page.ok);
      return page;
    };
    const open = await list({});
    assert.deepEqual(open.items, [
      { number: 12, title: 'Expected check', state: 'open', createdAt: day(5), author: 'octo', checks: 'pending', labels: [] },
      { number: 2, title: 'Draft tray order', state: 'draft', createdAt: day(2), author: 'mona', checks: 'pending', labels: [] },
      { number: 1, title: 'Fix sidebar refresh', state: 'open', createdAt: day(1), author: 'octo', checks: 'passed', labels: [bug] },
    ]);
    assert.deepEqual(open.labels, [bug, docs], 'the page carries the labels the repository defines');
    assert.deepEqual(open.counts, { open: 3, closed: 2 }, 'closed counts merged ones');
    const closed = await list({ state: 'closed' });
    assert.deepEqual(closed.items, [
      { number: 4, title: 'Dropped idea', state: 'closed', createdAt: day(4), author: null, checks: 'failed', labels: [] },
      { number: 3, title: 'Sidebar width', state: 'merged', createdAt: day(3), author: 'octo', checks: 'failed', labels: [bug, docs] },
    ]);
    assert.deepEqual((await list({ search: 'sidebar' })).items.map(item => item.number), [1], 'words match titles');
    assert.deepEqual((await list({ search: '#12' })).items.map(item => item.number), [12], 'a number matches the pull request number');
    const labelled = await list({ state: 'closed', labels: ['bug', 'docs'] });
    assert.deepEqual(labelled.items.map(item => item.number), [3], 'every chosen label must be present');
    assert.deepEqual(labelled.counts, { open: 0, closed: 1 });
  } finally { await f.close(); }
});

test('pull request list failures are reported like the issue list\'s', async context => {
  const double = await ghDouble(context, account);
  const f = await boundWorkbench('pull-request-failures');
  const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
  try {
    await double.set({ account: 'octo', repositories: [] });
    assert.deepEqual(await f.workbench.pullRequestPage(f.projectId, { filter: openNoFilter, cursor: null }), { ok: false, account: 'octo', failure: { kind: 'inaccessible', forge,
      detail: "GraphQL: Could not resolve to a Repository with the name 'octo/tools'. (repository)" } });
    double.uninstall();
    assert.deepEqual(await f.workbench.pullRequestPage(f.projectId, { filter: openNoFilter, cursor: null }),
      { ok: false, account: null, failure: { kind: 'notInstalled', forge, detail: '' } });
  } finally { await f.close(); }
});
