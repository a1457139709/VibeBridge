import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { Workbench } from '../app/main/workbench';
import {
  originElsewhereThanBinding,
  type ForgePresentation,
  type RepositoryChoices,
  type RepositoryReference,
} from '../app/shared/forge/forge';
import { ghDouble } from './support/gh-double';
import { bindListed, openNoFilter } from './support/bound-workbench';
import { interactiveWorkbench, until } from './support/interactive-workbench';

const account = { account: 'octo', repositories: ['octo/tools', 'Octo/VibeBridge', 'acme/forge'] };
/** A GitHub repository reference; the ID is one the forge does not list unless a test took it from a listing. */
const github = (path: string, id = '1'): RepositoryReference => ({ forge: 'github', host: 'github.com', id, path });

function setOrigin(directory: string, url: string) {
  execFileSync('git', ['init', '-q', directory]);
  execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', url]);
}

test('the repository origin points at is offered by default, and binding writes only a repository a fresh list shows', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-binding');
  try {
    setOrigin(f.directory, 'git@github.com:octo/vibebridge.git');
    const { project } = await f.create('Bound');
    const choices = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(choices.ok);
    assert.deepEqual(
      choices.repositories.map(item => [item.forge, item.host, item.path]),
      account.repositories.map(path => ['github', 'github.com', path]),
    );
    assert.equal(new Set(choices.repositories.map(item => item.id)).size, 3, 'each listed repository has its own ID');
    const [tools, vibeBridge, forge] = choices.repositories;
    assert.deepEqual(choices.origin, vibeBridge);
    assert.equal(choices.account, 'octo');
    assert.equal(f.workbench.snapshot().projects[0].repository, null, 'offering a default does not bind');

    await assert.rejects(
      f.workbench.bindRepository(project.id, github('octo/tools')),
      /repositoryNotListed/,
      'a listed path with an ID the forge does not list',
    );
    await assert.rejects(
      f.workbench.bindRepository(project.id, { forge: 'github', path: 'octo/tools' } as RepositoryReference),
      /repositoryNotListed/,
      'a reference without host and ID',
    );
    assert.equal(f.workbench.snapshot().projects[0].repository, null);

    await f.workbench.bindRepository(project.id, { ...tools, path: 'someone/else' });
    assert.deepEqual(f.workbench.snapshot().projects[0].repository, tools, 'the listed ID binds at its listed path');
    await f.workbench.bindRepository(project.id, vibeBridge);
    assert.deepEqual(f.workbench.snapshot().projects[0].repository, vibeBridge, 'binding again rebinds');
    await f.workbench.bindRepository(project.id, forge);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(reopened.snapshot().projects[0].repository, forge);
    } finally {
      await reopened.quit();
    }
  } finally {
    await f.close();
  }
});

test('forge failures are classified into the four kinds and carry the forge text unchanged', async context => {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-failures');
  try {
    const { project } = await f.create('Failing');
    const graphqlMissing = JSON.stringify({
      errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }],
    });
    for (const [failure, kind, detail] of [
      [
        { code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' },
        'loggedOut',
        'To get started with GitHub CLI, please run:  gh auth login',
      ],
      [
        { code: 1, stderr: 'HTTP 401: Bad credentials (https://api.github.com/user)\n' },
        'loggedOut',
        'HTTP 401: Bad credentials (https://api.github.com/user)',
      ],
      [
        { code: 1, stderr: 'HTTP 404: Not Found (https://api.github.com/user/repos)\n' },
        'inaccessible',
        'HTTP 404: Not Found (https://api.github.com/user/repos)',
      ],
      [
        { code: 1, stdout: graphqlMissing, stderr: 'GraphQL: Could not resolve to a Repository (repository)\n' },
        'inaccessible',
        'GraphQL: Could not resolve to a Repository (repository)',
      ],
      [
        { code: 1, stderr: 'HTTP 403: API rate limit exceeded 原样\n' },
        'transient',
        'HTTP 403: API rate limit exceeded 原样',
      ],
    ] as const) {
      await double.set({ ...account, failure });
      const choices = await f.workbench.repositoryChoices(project.id, f.directory);
      assert.deepEqual(
        choices,
        {
          ok: false,
          failure: {
            kind,
            detail,
            forge: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' },
          },
        },
        detail,
      );
      await assert.rejects(f.workbench.bindRepository(project.id, github('octo/tools')), /bindListFailed/);
    }
    double.uninstall();
    const missing = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(!missing.ok);
    assert.equal(missing.failure.kind, 'notInstalled');
    await assert.rejects(f.workbench.bindRepository(project.id, github('octo/tools')), /bindListFailed/);
    assert.equal(f.workbench.snapshot().projects[0].repository, null, 'a failed list check binds nothing');
  } finally {
    await f.close();
  }
});

test('an unbound project, or one whose directory has no origin on the forge, offers no default', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-no-origin');
  try {
    const { project } = await f.create('Plain');
    const plain = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(plain.ok);
    assert.equal(plain.origin, null);
    setOrigin(f.directory, 'https://gitlab.com/octo/tools.git');
    const elsewhere = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(elsewhere.ok);
    assert.equal(elsewhere.origin, null);
  } finally {
    await f.close();
  }
});

test('a failed list check leaves a bound project bound as it was', async context => {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-rebind-failure');
  try {
    const { project } = await f.create('Rebinding');
    await bindListed(f.workbench, project.id, 'octo/tools');
    const bound = f.workbench.snapshot().projects[0].repository;
    const choices = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(choices.ok);
    const forge = choices.repositories.find(item => item.path === 'acme/forge')!;
    await double.set({ ...account, failure: { code: 1, stderr: 'HTTP 502: Bad Gateway\n' } });
    await assert.rejects(f.workbench.bindRepository(project.id, forge), /bindListFailed/);
    await double.set({ ...account, repositories: ['octo/tools'] });
    await assert.rejects(f.workbench.bindRepository(project.id, forge), /repositoryNotListed/);
    assert.deepEqual(f.workbench.snapshot().projects[0].repository, bound);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(reopened.snapshot().projects[0].repository, bound, 'nothing was written');
    } finally {
      await reopened.quit();
    }
  } finally {
    await f.close();
  }
});

test('unbinding keeps the project and works without gh', async context => {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-unbind');
  try {
    const { project } = await f.create('Unbound later');
    await bindListed(f.workbench, project.id, 'octo/tools');
    double.uninstall();
    await f.workbench.unbindRepository(project.id);
    assert.equal(f.workbench.snapshot().projects[0].repository, null);
    assert.equal(f.workbench.snapshot().projects[0].name, 'Unbound later');
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.equal(reopened.snapshot().projects[0].repository, null, 'the unbinding is stored');
    } finally {
      await reopened.quit();
    }
  } finally {
    await f.close();
  }
});

test('saving a project edit leaves its binding as it was, without gh: an unbound project whose origin is listed stays unbound', async context => {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-edit-keeps-binding');
  try {
    setOrigin(f.directory, 'git@github.com:octo/vibebridge.git');
    const unbound = (await f.create('Unbound')).project;
    const boundDirectory = await mkdtemp(join(f.directory, 'bound-'));
    const bound = (await f.create('Bound', boundDirectory)).project;
    await bindListed(f.workbench, bound.id, 'octo/tools');
    const tools = f.workbench.snapshot().projects[1].repository;
    const moved = await mkdtemp(join(f.directory, 'moved-'));
    setOrigin(moved, 'https://github.com/acme/forge.git');
    double.uninstall();

    await f.workbench.editProject(unbound.id, { name: 'Renamed', directory: f.directory }, false);
    await f.workbench.editProject(bound.id, { name: 'Moved', directory: moved }, false);
    const expected = [
      ['Renamed', f.directory, null],
      ['Moved', moved, tools],
    ];
    const saved = (workbench: Workbench) =>
      workbench.snapshot().projects.map(item => [item.name, item.directory, item.repository]);
    assert.deepEqual(saved(f.workbench), expected);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(saved(reopened), expected, 'the bindings are stored as they were');
    } finally {
      await reopened.quit();
    }
  } finally {
    await f.close();
  }
});

test('deleting a bound project removes it for good', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-delete');
  try {
    const { project } = await f.create('Deleted');
    await bindListed(f.workbench, project.id, 'octo/tools');
    await f.workbench.deleteProject(project.id);
    assert.deepEqual(f.workbench.snapshot().projects, []);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(reopened.snapshot().projects, []);
    } finally {
      await reopened.quit();
    }
  } finally {
    await f.close();
  }
});

test('the default comes from the origin of the directory the dialog shows, not only the stored one', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-new-directory');
  try {
    const { project } = await f.create('Moving');
    const moved = await mkdtemp(join(f.directory, 'moved-'));
    setOrigin(moved, 'https://github.com/acme/forge.git');
    const choices = await f.workbench.repositoryChoices(project.id, moved);
    assert.ok(choices.ok);
    assert.equal(choices.origin?.path, 'acme/forge');
  } finally {
    await f.close();
  }
});

test('the origin URL matches a listed path in any case and offers it in its listed spelling', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-case');
  try {
    setOrigin(f.directory, 'https://github.com/OCTO/vibebridge');
    const { project } = await f.create('Cased');
    const choices = await f.workbench.repositoryChoices(project.id, f.directory);
    assert.ok(choices.ok);
    assert.equal(choices.origin?.path, 'Octo/VibeBridge');
  } finally {
    await f.close();
  }
});

/** A project bound to octo/tools, the repository's ID, and a way to read the project's binding. */
async function boundToTools(context: test.TestContext, scope: string) {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench(scope);
  const { project } = await f.create('Followed');
  await bindListed(f.workbench, project.id, 'octo/tools');
  const bound = () => f.workbench.snapshot().projects[0].repository;
  return { double, f, projectId: project.id, id: bound()!.id, bound };
}

for (const [move, redirects] of [
  ['renamed while GitHub redirects its former path', { 'octo/tools': 'octo/tools-x' }],
  ['renamed with no redirect left', {}],
] as const) {
  test(`a bound repository ${move} is found by its ID, and the binding follows it to its new path`, async context => {
    const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-renamed');
    try {
      await double.set({
        ...account,
        repositories: [{ id: Number(id), path: 'octo/tools-x' }, 'acme/forge'],
        redirects,
      });
      const page = await f.workbench.issuePage(projectId, { filter: openNoFilter, cursor: null });
      assert.ok(page.ok, 'the list loads from the new path');
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

test("a new repository at a deleted bound repository's path is not the bound one: the binding is inaccessible and stays as it was", async context => {
  const { double, f, projectId, id, bound } = await boundToTools(context, 'repository-replaced');
  try {
    await double.set({ ...account, repositories: [{ id: Number(id) + 1, path: 'octo/tools' }] });
    const page = await f.workbench.issuePage(projectId, { filter: openNoFilter, cursor: null });
    assert.ok(!page.ok);
    assert.equal(page.failure.kind, 'inaccessible');
    assert.equal(page.account, 'octo');
    assert.deepEqual(bound(), github('octo/tools', id));
  } finally {
    await f.close();
  }
});

test("Edit project's note names the new directory's origin only when it points at another repository than the binding", () => {
  const forge: ForgePresentation = { name: 'GitHub', cli: 'gh', installUrl: '', loginCommand: '' };
  const tools = github('octo/tools', '1');
  const other = github('acme/forge', '2');
  const listing = (origin: RepositoryReference | null): RepositoryChoices => ({
    ok: true,
    forge,
    account: 'octo',
    origin,
    repositories: [tools, other],
  });
  assert.deepEqual(originElsewhereThanBinding(tools, listing(other)), other, 'origin points at another repository');
  for (const [state, bound, choices] of [
    ['unbound', null, listing(other)],
    ['origin points at the binding', tools, listing(tools)],
    ['origin points at the binding at a new path', tools, listing(github('octo/renamed', '1'))],
    ['origin points at no listed repository', tools, listing(null)],
    ['the list is loading', tools, undefined],
    ['the list cannot be read', tools, { ok: false, failure: { kind: 'notInstalled', detail: '', forge } }],
  ] as const)
    assert.equal(originElsewhereThanBinding(bound, choices), null, state);
});
