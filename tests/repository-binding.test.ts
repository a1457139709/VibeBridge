import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { testDirectory } from './support/directory';
import { ghDouble } from './support/gh-double';

/** A Workbench in its own data directory with one project whose Agent runs tests/fixtures/interactive.cjs. */
async function boundWorkbench(context: TestContext, scope: string) {
  const directory = await testDirectory(context, scope);
  let workbench = await Workbench.open(directory);
  context.after(() => workbench.quit());
  const agents = workbench.snapshot().settings.agents;
  agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
  await workbench.saveSettings({ agents });
  const { project } = await workbench.createProject({ name: 'Bound', directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
  return {
    directory, project, get workbench() { return workbench; },
    repository: () => workbench.snapshot().projects.find(item => item.id === project.id)?.repository,
    async reopen() { await workbench.quit(); workbench = await Workbench.open(directory); },
  };
}

test('a project binds only a repository the signed-in account can choose, and the binding survives reopening', async context => {
  await ghDouble(context, { login: 'octo', repositories: ['octo/app', 'octo/docs', 'acme/platform'] });
  const f = await boundWorkbench(context, 'repository-binding');
  const choices = await f.workbench.repositoryChoices(f.project.id);
  assert.ok(choices.ok, JSON.stringify(choices));
  assert.equal(choices.account, 'octo');
  assert.deepEqual(choices.repositories, [
    { platform: 'github', path: 'octo/app' }, { platform: 'github', path: 'octo/docs' }, { platform: 'github', path: 'acme/platform' }]);
  assert.equal(f.repository(), undefined);

  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'acme/platform' });
  assert.deepEqual(f.repository(), { platform: 'github', path: 'acme/platform' });
  await assert.rejects(f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'someone/else' }), /repositoryNotListed/);
  await assert.rejects(f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'https://github.com/octo/app' }), /repositoryNotListed/);
  assert.deepEqual(f.repository(), { platform: 'github', path: 'acme/platform' });

  await f.reopen();
  assert.deepEqual(f.repository(), { platform: 'github', path: 'acme/platform' });
  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/docs' });
  await f.workbench.bindRepository(f.project.id, null);
  await f.reopen();
  assert.equal(f.repository(), undefined);
});

const git = (directory: string, ...args: string[]) => { execFileSync('git', args, { cwd: directory }); };

test('the listed repository the project directory\'s origin points to is suggested but stays unbound until saved', async context => {
  await ghDouble(context, { login: 'octo', repositories: ['octo/app', 'Acme/Platform'] });
  const f = await boundWorkbench(context, 'repository-origin');
  const suggestion = async () => {
    const choices = await f.workbench.repositoryChoices(f.project.id);
    assert.ok(choices.ok, JSON.stringify(choices));
    return choices.suggested;
  };
  git(f.directory, 'init', '--quiet');
  assert.equal(await suggestion(), null, 'a repository without origin suggests nothing');
  git(f.directory, 'remote', 'add', 'origin', 'https://gitlab.com/acme/platform.git');
  assert.equal(await suggestion(), null, 'an origin on another host suggests nothing');
  for (const url of ['git@github.com:acme/platform.git', 'https://github.com/acme/platform', 'ssh://git@github.com/Acme/Platform.git']) {
    git(f.directory, 'remote', 'set-url', 'origin', url);
    assert.deepEqual(await suggestion(), { platform: 'github', path: 'Acme/Platform' }, url);
  }
  git(f.directory, 'remote', 'set-url', 'origin', 'git@github.com:someone/else.git');
  assert.equal(await suggestion(), null, 'an origin outside the list suggests nothing');
  assert.equal(f.repository(), undefined);
});

test('platform failures are told apart by kind, carry the CLI\'s own words and keep the binding unchanged', async context => {
  const double = await ghDouble(context, { login: 'octo', repositories: ['octo/app'] });
  const f = await boundWorkbench(context, 'repository-failures');
  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/app' });
  const signedOut = 'You are not logged into any GitHub hosts. To log in, run: gh auth login';
  const notFound = JSON.stringify({ data: null, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository with the name \'octo/app\'.' }] });
  for (const [kind, failure, output] of [
    ['signedOut', { exit: 4, stderr: signedOut }, signedOut],
    ['signedOut', { exit: 1, stderr: 'HTTP 401: Bad credentials (https://api.github.com/graphql)' }, 'HTTP 401: Bad credentials (https://api.github.com/graphql)'],
    ['unreachable', { exit: 1, stdout: notFound, stderr: 'gh: Could not resolve to a Repository with the name \'octo/app\'.' }, `gh: Could not resolve to a Repository with the name 'octo/app'.\n${notFound}`],
    ['unreachable', { exit: 1, stderr: 'HTTP 404: Not Found (https://api.github.com/repos/octo/app)' }, 'HTTP 404: Not Found (https://api.github.com/repos/octo/app)'],
    ['transient', { exit: 1, stderr: 'HTTP 502: Bad Gateway 原样' }, 'HTTP 502: Bad Gateway 原样'],
  ] as const) {
    await double.set({ failure });
    const choices = await f.workbench.repositoryChoices(f.project.id);
    assert.ok(!choices.ok);
    assert.deepEqual({ kind: choices.failure.kind, output: choices.failure.output }, { kind, output }, failure.stderr);
    assert.equal(choices.failure.platform.signInCommand, 'gh auth login');
    await assert.rejects(f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/app' }), /repositoryListFailed/);
  }
  await double.uninstall();
  const choices = await f.workbench.repositoryChoices(f.project.id);
  assert.ok(!choices.ok);
  assert.equal(choices.failure.kind, 'notInstalled');
  assert.equal(choices.failure.platform.installUrl, 'https://cli.github.com');
  await assert.rejects(f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/app' }), /repositoryListFailed/);
  assert.deepEqual(f.repository(), { platform: 'github', path: 'octo/app' });
});

test('deleting a bound project removes its binding with it and the workbench reopens', async context => {
  await ghDouble(context, { login: 'octo', repositories: ['octo/app'] });
  const f = await boundWorkbench(context, 'repository-deletion');
  await f.workbench.bindRepository(f.project.id, { platform: 'github', path: 'octo/app' });
  await f.workbench.deleteProject(f.project.id);
  await f.reopen();
  assert.deepEqual(f.workbench.snapshot().projects, []);
});
