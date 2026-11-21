import test from 'node:test';
import assert from 'node:assert/strict';
import { Workbench } from '../app/main/workbench';
import type { RepositoryReference } from '../app/shared/forge/forge';
import { ghDouble } from './support/gh-double';
import {
  bindListed,
  day,
  issueDetail,
  openNoFilter,
  pullRequestDetail,
  refreshList,
  showList,
} from './support/bound-workbench';
import type { ForgeLists } from '../app/shared/forge/sidebar-data';
import { interactiveWorkbench, until } from './support/interactive-workbench';

// A Repository Binding follows its repository by ID: reads check it in their own request and locate it only when that
// check fails; writes trust the last read (docs/adr/0006-forges-sit-behind-an-interface.md).

const account = { account: 'octo', repositories: ['octo/tools', 'Octo/VibeBridge', 'acme/forge'] };
const github = (path: string, id: string): RepositoryReference => ({ forge: 'github', host: 'github.com', id, path });

/** A project bound to octo/tools, the repository's ID, and a way to read the project's binding. */
async function boundToTools(context: test.TestContext, scope: string) {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Followed');
  await bindListed(f.workbench, project.id, 'octo/tools');
  const bound = () => f.workbench.snapshot().projects[0].repository;
  return { double, f, projectId: project.id, id: bound()!.id, bound };
}

/** What each `gh` call asked of GitHub: a GraphQL query and the path it named, a REST path, or a write and its repository. */
const asked = (calls: string[][]) =>
  calls.map(args => {
    if (args[1] === 'graphql') {
      const field = (key: string) => args.find(arg => arg.startsWith(`${key}=`))!.slice(key.length + 1);
      return `graphql ${field('owner')}/${field('name')}`;
    }
    if (args[0] === 'api') return `api ${args[1]}`;
    return `${args[0]} ${args[1]} --repo ${args[args.indexOf('--repo') + 1]}`;
  });
const toolsItems = {
  issues: [{ number: 3, title: 'Issue 3', state: 'OPEN' as const, createdAt: day(3), labels: [] }],
  pullRequests: [{ number: 4, title: 'Change 4', state: 'OPEN' as const }],
};

test('a read of a repository still at its bound path asks gh once, checking the repository in the same request', async context => {
  const { double, f, projectId } = await boundToTools(context, 'repository-checked');
  try {
    await double.set({ ...account, ...toolsItems });
    await double.calls();
    assert.ok((await showList(f.workbench, projectId)).issues.loaded);
    assert.deepEqual(asked(await double.calls()), ['graphql octo/tools'], 'a list page');
    assert.ok((await issueDetail(f.workbench, projectId, 3)).ok);
    assert.deepEqual(asked(await double.calls()), ['graphql octo/tools'], 'an issue');
    assert.ok((await pullRequestDetail(f.workbench, projectId, 4)).ok);
    assert.deepEqual(asked(await double.calls()), ['graphql octo/tools'], 'a pull request');
  } finally {
    await f.close();
  }
});

test('a direct action is written at the bound path with one gh call, located by no request before it', async context => {
  const { double, f, projectId } = await boundToTools(context, 'repository-written');
  try {
    await double.set({ ...account, ...toolsItems });
    await double.calls();
    assert.ok((await f.workbench.directAction(projectId, { kind: 'closeIssue', number: 3, reason: 'completed' })).ok);
    assert.deepEqual(asked(await double.calls()), ['issue close --repo octo/tools']);
  } finally {
    await f.close();
  }
});

for (const [move, redirects, calls] of [
  [
    'renamed while GitHub redirects its former path',
    { 'octo/tools': 'octo/tools-x' },
    // The answer at the former path names the repository's ID and new path; the search there is not trusted.
    ['graphql octo/tools', 'graphql octo/tools-x'],
  ],
  [
    'renamed with no redirect left',
    {},
    ['graphql octo/tools', 'graphql octo/tools', 'api repositories/{id}', 'graphql octo/tools-x'],
  ],
] as const) {
  test(`a bound repository ${move} is found by its ID, and the binding follows it to its new path`, async context => {
    const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-renamed');
    try {
      await double.set({
        ...account,
        repositories: [{ id: Number(id), path: 'octo/tools-x' }, 'acme/forge'],
        redirects,
      });
      await double.calls();
      const { issues } = await showList(f.workbench, projectId);
      assert.ok(issues.loaded && !issues.failed, 'the list loads from the new path');
      assert.deepEqual(
        asked(await double.calls()),
        calls.map(call => call.replace('{id}', id)),
        'the list shown is the one read again at the new path',
      );
      await until(() => bound()?.path === 'octo/tools-x');
      assert.deepEqual(bound(), github('octo/tools-x', id));
      const choices = await f.workbench.repositoryChoices(projectId, f.directory);
      assert.ok(choices.ok);
      assert.deepEqual(
        choices.repositories.map(item => item.path),
        ['octo/tools-x', 'acme/forge'],
        'the binding is listed once, at its new path',
      );
      await f.workbench.quit();
      const reopened = await Workbench.open(f.directory);
      try {
        assert.deepEqual(
          reopened.snapshot().projects[0].repository,
          github('octo/tools-x', id),
          'the new path is stored',
        );
      } finally {
        await reopened.quit();
      }
    } finally {
      await f.close();
    }
  });
}

test('a bound repository transferred to another owner follows from the list of repositories the change-binding page opens with', async context => {
  const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-transferred');
  try {
    await double.set({ ...account, repositories: [{ id: Number(id), path: 'acme/tools' }] });
    const choices = await f.workbench.repositoryChoices(projectId, f.directory);
    assert.ok(choices.ok);
    await until(() => bound()?.path === 'acme/tools');
    assert.deepEqual(bound(), github('acme/tools', id));
  } finally {
    await f.close();
  }
});

test('a bound repository moved away from a path another repository took is found by its ID, and the read is asked again at its new path', async context => {
  const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-displaced');
  try {
    await double.set({
      ...account,
      ...toolsItems,
      repositories: [
        { id: Number(id) + 1, path: 'octo/tools' },
        { id: Number(id), path: 'octo/tools-moved' },
      ],
    });
    await double.calls();
    const detail = await issueDetail(f.workbench, projectId, 3);
    assert.ok(detail.ok);
    assert.equal(detail.issue.url, 'https://github.com/octo/tools-moved/issues/3', 'the detail read at the new path');
    assert.deepEqual(asked(await double.calls()), [
      'graphql octo/tools',
      'graphql octo/tools',
      `api repositories/${id}`,
      'graphql octo/tools-moved',
    ]);
    await until(() => bound()?.path === 'octo/tools-moved');
  } finally {
    await f.close();
  }
});

test('a deleted bound repository is inaccessible to reads and writes alike, and the binding stays as it was', async context => {
  const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-deleted');
  try {
    await double.set({ ...account, ...toolsItems, repositories: ['acme/forge'] });
    const { failed } = (await showList(f.workbench, projectId)).issues;
    assert.equal(failed?.failure.kind, 'inaccessible');
    assert.equal(failed?.account, 'octo');
    const detail = await issueDetail(f.workbench, projectId, 3);
    assert.equal(!detail.ok && detail.failure.kind, 'inaccessible');
    await double.calls();
    const written = await f.workbench.directAction(projectId, { kind: 'reopenIssue', number: 3 });
    assert.equal(!written.ok && written.failure.kind, 'inaccessible');
    assert.deepEqual(asked(await double.calls()), ['issue reopen --repo octo/tools']);
    assert.deepEqual(bound(), github('octo/tools', id));
  } finally {
    await f.close();
  }
});

test("a new repository at a deleted bound repository's path is not the bound one: the binding is inaccessible and stays as it was", async context => {
  const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-replaced');
  try {
    await double.set({ ...account, repositories: [{ id: Number(id) + 1, path: 'octo/tools' }] });
    const { failed } = (await showList(f.workbench, projectId)).issues;
    assert.equal(failed?.failure.kind, 'inaccessible');
    assert.equal(failed?.account, 'octo');
    assert.deepEqual(bound(), github('octo/tools', id));
  } finally {
    await f.close();
  }
});

test("following a renamed repository keeps the project's kept rows; rebinding or unbinding drops them at once", async context => {
  const { double, f, projectId, id } = await boundToTools(context, 'kept-rows-binding');
  /** The lists the sidebar shows at once on declaring the project's issues, before the forge answers. */
  const shownAtOnce = async () => {
    let first: ForgeLists | undefined;
    const stop = f.workbench.subscribe(event => {
      if (event.kind === 'forgeLists' && event.projectId === projectId) first ??= event.lists;
    });
    try {
      await f.workbench.forgeSidebar.showList(projectId, { tab: 'issues', filter: openNoFilter });
    } finally {
      stop();
    }
    return first?.issues.loaded?.filter;
  };
  try {
    await showList(f.workbench, projectId);
    await double.set({ ...account, repositories: [{ id: Number(id), path: 'octo/tools-x' }, 'acme/forge'] });
    await refreshList(f.workbench, projectId);
    assert.deepEqual(await shownAtOnce(), openNoFilter, 'the rows stay kept once the binding follows the rename');
    await bindListed(f.workbench, projectId, 'acme/forge');
    assert.equal(await shownAtOnce(), undefined, 'no rows of the repository bound before show');
    await f.workbench.unbindRepository(projectId);
    assert.equal(await shownAtOnce(), undefined, 'no rows show once unbound');
  } finally {
    await f.close();
  }
});
