import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('installed pre-commit checks the working tree, blocks each failing check and leaves the index untouched', async () => {
  await mkdir('work/commit-gate', { recursive: true });
  const directory = await mkdtemp(resolve('work/commit-gate/repo-'));
  // A hook's Git environment points at the caller's index. Never inherit it into
  // the disposable repository used to exercise the real Git hook protocol.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HUSKY: '1' });
  const run = (command: string, args: string[], extra = {}) => spawnSync(command, args, { cwd: directory,
    env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 });
  const git = (...args: string[]) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-q'); git('config', 'user.name', 'Gate test'); git('config', 'user.email', 'gate@example.invalid');
    await writeFile(`${directory}/sample.txt`, 'initial'); git('add', 'sample.txt'); git('commit', '-qm', 'Initial');
    const originalHead = git('rev-parse', 'HEAD');
    const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
    await writeFile(`${directory}/package.json`, JSON.stringify({ private: true, type: 'module', scripts }));
    await mkdir(`${directory}/.husky`); await copyFile('.husky/pre-commit', `${directory}/.husky/pre-commit`);
    await mkdir(`${directory}/scripts`); await mkdir(`${directory}/node_modules/.bin`, { recursive: true });
    await symlink(resolve('node_modules/husky/bin.mjs'), `${directory}/node_modules/.bin/husky`);
    const check = (stage: string) => `import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync('checks.jsonl', JSON.stringify({ stage: '${stage}', input: readFileSync('sample.txt', 'utf8') }) + '\\n');
if (process.env.FAIL_CHECK === '${stage}') { console.error('FAILED:${stage}'); process.exit(1); }`;
    await writeFile(`${directory}/scripts/typecheck.mjs`, check('typecheck'));
    await writeFile(`${directory}/scripts/test.mjs`, check('modules'));
    await writeFile(`${directory}/scripts/test-components.mjs`, check('components'));
    await writeFile(`${directory}/node_modules/.bin/tsc`, '#!/bin/sh\nexec node scripts/typecheck.mjs\n');
    await chmod(`${directory}/node_modules/.bin/tsc`, 0o755);
    const installed = run('npm', ['run', 'prepare']);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(git('config', '--get', 'core.hooksPath'), '.husky/_');
    await writeFile(`${directory}/sample.txt`, 'staged'); git('add', 'sample.txt');
    await writeFile(`${directory}/sample.txt`, 'working tree');
    const staged = git('diff', '--cached'), unstaged = git('diff');
    const stages = ['typecheck', 'modules', 'components'];
    for (const [index, stage] of stages.entries()) {
      await writeFile(`${directory}/checks.jsonl`, '');
      const result = run('git', ['commit', '-m', `Fails ${stage}`], { FAIL_CHECK: stage });
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, new RegExp(`FAILED:${stage}`));
      assert.equal(git('rev-parse', 'HEAD'), originalHead);
      assert.equal(git('diff', '--cached'), staged); assert.equal(git('diff'), unstaged);
      const checks = (await readFile(`${directory}/checks.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(checks, stages.slice(0, index + 1).map(stage => ({ stage, input: 'working tree' })));
    }
    await writeFile(`${directory}/checks.jsonl`, '');
    const committed = run('git', ['commit', '-m', 'All checks pass']);
    assert.equal(committed.status, 0, committed.stdout + committed.stderr);
    const checks = (await readFile(`${directory}/checks.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(checks, stages.map(stage => ({ stage, input: 'working tree' })));
    assert.equal(git('show', 'HEAD:sample.txt'), 'staged');
    assert.equal(await readFile(`${directory}/sample.txt`, 'utf8'), 'working tree');
    assert.equal(git('diff'), unstaged);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
