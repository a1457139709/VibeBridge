import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('installed pre-commit blocks oversized staged files before working-tree checks and leaves the index untouched', async () => {
  await mkdir('work/commit-gate', { recursive: true });
  const directory = await mkdtemp(resolve('work/commit-gate/repo-'));
  // A hook's Git environment points at the caller's index. Never inherit it into
  // the disposable repository used to exercise the real Git hook protocol.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', HUSKY: '1',
    npm_config_cache: `${directory}/npm-cache` });
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
    await copyFile('scripts/check-staged-file-size.mjs', `${directory}/scripts/check-staged-file-size.mjs`);
    await symlink(resolve('node_modules/husky/bin.mjs'), `${directory}/node_modules/.bin/husky`);
    const check = (stage: string) => `import { appendFileSync, readFileSync } from 'node:fs';
appendFileSync('checks.jsonl', JSON.stringify({ stage: '${stage}', input: readFileSync('sample.txt', 'utf8') }) + '\\n');
if (process.env.FAIL_CHECK === '${stage}') { console.error('FAILED:${stage}'); process.exit(1); }`;
    await writeFile(`${directory}/scripts/check-source-paths.mjs`, check('source-paths'));
    await writeFile(`${directory}/scripts/typecheck.mjs`, check('typecheck'));
    await writeFile(`${directory}/scripts/test.mjs`, check('modules'));
    await writeFile(`${directory}/scripts/test-components.mjs`, check('components'));
    await writeFile(`${directory}/node_modules/.bin/tsc`, '#!/bin/sh\nexec node scripts/typecheck.mjs\n');
    await chmod(`${directory}/node_modules/.bin/tsc`, 0o755);
    const installed = run('npm', ['run', 'prepare']);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(git('config', '--get', 'core.hooksPath'), '.husky/_');
    await writeFile(`${directory}/sample.txt`, 'x'.repeat(20001)); git('add', 'sample.txt');
    await writeFile(`${directory}/sample.txt`, 'small unstaged replacement');
    const oversizedIndex = git('diff', '--cached'), oversizedWorktree = git('diff');
    await writeFile(`${directory}/checks.jsonl`, '');
    const oversized = run('git', ['commit', '-m', 'Oversized staged file']);
    assert.notEqual(oversized.status, 0);
    assert.match(oversized.stdout + oversized.stderr, /5000\.25 tokens \(20001 bytes\)/);
    assert.equal(await readFile(`${directory}/checks.jsonl`, 'utf8'), '', 'Size failures stop before any working-tree checks');
    assert.equal(git('rev-parse', 'HEAD'), originalHead);
    assert.equal(git('diff', '--cached'), oversizedIndex);
    assert.equal(git('diff'), oversizedWorktree);
    await writeFile(`${directory}/sample.txt`, 'staged'); git('add', 'sample.txt');
    await writeFile(`${directory}/sample.txt`, 'working tree');
    const staged = git('diff', '--cached'), unstaged = git('diff');
    const stages = ['source-paths', 'typecheck', 'modules', 'components'];
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
