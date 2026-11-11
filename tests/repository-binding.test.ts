import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Workbench } from '../app/main/workbench';
import { ghDouble } from './support/gh-double';
import { interactiveWorkbench } from './support/interactive-workbench';

const github = (path: string) => ({ platform: 'github' as const, path });
const account = { account: 'octo', repositories: ['octo/tools', 'Octo/VibeBridge', 'acme/platform'] };

function setOrigin(directory: string, url: string) {
  execFileSync('git', ['init', '-q', directory]);
  execFileSync('git', ['-C', directory, 'remote', 'add', 'origin', url]);
}

test('the repository origin points at is offered by default, and only a saved, listed repository is bound', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-binding');
  try {
    setOrigin(f.directory, 'git@github.com:octo/vibebridge.git');
    const { project } = await f.create('Bound');
    const choices = await f.workbench.repositoryChoices(project.id);
    assert.ok(choices.ok);
    assert.deepEqual(choices.repositories, account.repositories.map(github));
    assert.deepEqual(choices.origin, github('Octo/VibeBridge'));
    assert.equal(choices.account, 'octo');
    assert.equal(f.workbench.snapshot().projects[0].repository, null, 'offering a default does not bind');

    await assert.rejects(f.workbench.bindRepository(project.id, github('someone/else')), /repositoryNotListed/);
    await assert.rejects(f.workbench.bindRepository(project.id, github('https://github.com/octo/tools')), /repositoryNotListed/);
    assert.equal(f.workbench.snapshot().projects[0].repository, null);

    await f.workbench.bindRepository(project.id, github('Octo/VibeBridge'));
    assert.deepEqual(f.workbench.snapshot().projects[0].repository, github('Octo/VibeBridge'));
    await f.workbench.bindRepository(project.id, github('acme/platform'));
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try { assert.deepEqual(reopened.snapshot().projects[0].repository, github('acme/platform')); }
    finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('platform failures are classified into the four kinds and carry the platform text unchanged', async context => {
  const double = await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-failures');
  try {
    const { project } = await f.create('Failing');
    const graphqlMissing = JSON.stringify({ errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository' }] });
    for (const [failure, kind, detail] of [
      [{ code: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }, 'loggedOut', 'To get started with GitHub CLI, please run:  gh auth login'],
      [{ code: 1, stderr: 'HTTP 401: Bad credentials (https://api.github.com/user)\n' }, 'loggedOut', 'HTTP 401: Bad credentials (https://api.github.com/user)'],
      [{ code: 1, stderr: 'HTTP 404: Not Found (https://api.github.com/user/repos)\n' }, 'inaccessible', 'HTTP 404: Not Found (https://api.github.com/user/repos)'],
      [{ code: 1, stdout: graphqlMissing, stderr: 'GraphQL: Could not resolve to a Repository (repository)\n' }, 'inaccessible', 'GraphQL: Could not resolve to a Repository (repository)'],
      [{ code: 1, stderr: 'HTTP 403: API rate limit exceeded 原样\n' }, 'transient', 'HTTP 403: API rate limit exceeded 原样'],
    ] as const) {
      await double.set({ ...account, failure });
      const choices = await f.workbench.repositoryChoices(project.id);
      assert.deepEqual(choices, { ok: false, failure: { kind, detail, platform: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' } } }, detail);
      await assert.rejects(f.workbench.bindRepository(project.id, github('octo/tools')), /repositoryListFailed/);
    }
    double.uninstall();
    const missing = await f.workbench.repositoryChoices(project.id);
    assert.ok(!missing.ok);
    assert.equal(missing.failure.kind, 'notInstalled');
    await assert.rejects(f.workbench.bindRepository(project.id, github('octo/tools')), /repositoryListFailed/);
    assert.equal(f.workbench.snapshot().projects[0].repository, null);
  } finally { await f.close(); }
});

test('an unbound project, or one whose directory has no origin on the platform, offers no default', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-no-origin');
  try {
    const { project } = await f.create('Plain');
    const plain = await f.workbench.repositoryChoices(project.id);
    assert.ok(plain.ok);
    assert.equal(plain.origin, null);
    setOrigin(f.directory, 'https://gitlab.com/octo/tools.git');
    const elsewhere = await f.workbench.repositoryChoices(project.id);
    assert.ok(elsewhere.ok);
    assert.equal(elsewhere.origin, null);
  } finally { await f.close(); }
});

test('unbinding keeps the project, and deleting a bound project removes it for good', async context => {
  await ghDouble(context, account);
  const f = await interactiveWorkbench('repository-unbind');
  try {
    const { project } = await f.create('Unbound later');
    await f.workbench.bindRepository(project.id, github('octo/tools'));
    await f.workbench.bindRepository(project.id, null);
    assert.equal(f.workbench.snapshot().projects[0].repository, null);
    await f.workbench.bindRepository(project.id, github('octo/tools'));
    await f.workbench.deleteProject(project.id);
    assert.deepEqual(f.workbench.snapshot().projects, []);
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try { assert.deepEqual(reopened.snapshot().projects, []); }
    finally { await reopened.quit(); }
  } finally { await f.close(); }
});
