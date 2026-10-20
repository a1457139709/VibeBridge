import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

async function fixture() {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(resolve('work/staged-file-size-'));
  // A nested test repository must never inherit the real commit's index or Git directory.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HUSKY: '1',
    npm_config_cache: `${directory}/npm-cache` });
  const run = (command: string, args: string[], extra = {}) => spawnSync(command, args, {
    cwd: directory, env: { ...env, ...extra }, encoding: 'utf8', timeout: 10000,
  });
  const git = (...args: string[]) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    await mkdir(`${directory}/scripts`);
    await mkdir(`${directory}/.husky`);
    for (const file of ['scripts/check-staged-file-size.mjs', '.husky/pre-commit', '.gitattributes']) {
      await copyFile(file, `${directory}/${file}`);
    }
    const { scripts } = JSON.parse(await readFile('package.json', 'utf8'));
    // The existing commit-gate test covers the full check chain; isolate file-size behavior here.
    await writeFile(`${directory}/package.json`, JSON.stringify({ private: true, type: 'module',
      scripts: { prepare: scripts.prepare, check: 'node --version' } }));
    await mkdir(`${directory}/node_modules/.bin`, { recursive: true });
    await symlink(resolve('node_modules/husky/bin.mjs'), `${directory}/node_modules/.bin/husky`);
    git('init', '--quiet');
    const installed = run('npm', ['run', 'prepare']);
    assert.equal(installed.status, 0, installed.stderr);
    return {
      directory, git, run,
      write: async (file: string, content: string) => {
        await mkdir(dirname(`${directory}/${file}`), { recursive: true });
        await writeFile(`${directory}/${file}`, content);
      },
      check: () => run(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath, ['scripts/check-staged-file-size.mjs']),
      commit: (skipHook = false) => run('git', [
        '-c', 'user.name=Hook Test', '-c', 'user.email=hook@example.invalid', '-c', 'commit.gpgSign=false',
        ...(skipHook ? ['-c', 'core.hooksPath=/dev/null'] : []), 'commit', '--quiet', '-m', 'fixture',
      ]),
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

test('prepare installs the hook; real commits accept 20,000 bytes and reject 20,001 bytes', async () => {
  const f = await fixture();
  try {
    assert.equal(f.git('config', '--get', 'core.hooksPath').trim(), '.husky/_');
    await f.write('source.ts', 'a'.repeat(20000));
    f.git('add', '--', 'source.ts');
    assert.equal(f.commit().status, 0);
    await f.write('source.ts', 'a'.repeat(20001));
    f.git('add', '--', 'source.ts');
    const rejected = f.commit();
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /source\.ts.*5000\.25 tokens \(20001 bytes\)/);
    assert.match(rejected.stderr, /update imports\/exports and callers/);
    assert.match(rejected.stderr, /git add the original and new files/);
    assert.equal(f.git('rev-list', '--count', 'HEAD').trim(), '1');
  } finally { await f.close(); }
});

test('only staged blobs count, including both directions of partial staging', async () => {
  const f = await fixture();
  try {
    await f.write('untracked.ts', 'x'.repeat(25000));
    assert.equal(f.check().status, 0);
    await f.write('source.ts', 'small');
    f.git('add', '--', 'source.ts');
    await f.write('source.ts', 'x'.repeat(25000));
    assert.equal(f.check().status, 0);
    f.git('add', '--', 'source.ts');
    await f.write('source.ts', 'small');
    const indexBefore = f.git('ls-files', '--stage');
    assert.equal(f.check().status, 1);
    assert.equal(f.git('ls-files', '--stage'), indexBefore);
    // Commits selecting paths use an alternate index, which the hook must honor.
    const alternateIndex = `${f.directory}/alternate-index`;
    const loaded = f.run('git', ['read-tree', '--empty'], { GIT_INDEX_FILE: alternateIndex });
    assert.equal(loaded.status, 0, loaded.stderr);
    const checked = f.run(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
      ['scripts/check-staged-file-size.mjs'], { GIT_INDEX_FILE: alternateIndex });
    assert.equal(checked.status, 0, checked.stderr);
  } finally { await f.close(); }
});

test('staged generated and vendored attributes exclude tool output, but not authored files', async () => {
  const f = await fixture();
  try {
    await f.write('.gitattributes', `package-lock.json linguist-generated
**/generated/** linguist-generated
*.generated.* linguist-generated=true
*.gen.* linguist-generated
vendor/** linguist-vendored
handwritten.ts -linguist-generated
`);
    for (const file of ['package-lock.json', 'generated/client.ts', 'src/generated/types.ts',
      'client.generated.ts', 'client.gen.ts', 'vendor/lib.js', 'handwritten.ts']) {
      await f.write(file, 'x'.repeat(25000));
      f.git('add', '--', file);
    }
    f.git('add', '--', '.gitattributes');
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /handwritten\.ts/);
    assert.doesNotMatch(result.stderr, /package-lock\.json|client\.ts|types\.ts|client\.generated\.ts|client\.gen\.ts|lib\.js/);
    f.git('rm', '--cached', '--', 'handwritten.ts');
    assert.equal(f.check().status, 0);
  } finally { await f.close(); }
});

test('unstaged attribute changes cannot alter exclusions', async () => {
  const f = await fixture();
  try {
    await f.write('.gitattributes', '');
    await f.write('source.ts', 'x'.repeat(25000));
    f.git('add', '--', '.gitattributes', 'source.ts');
    await f.write('.gitattributes', 'source.ts linguist-generated\n');
    assert.equal(f.check().status, 1);
    f.git('add', '--', '.gitattributes');
    await f.write('.gitattributes', '');
    assert.equal(f.check().status, 0);
  } finally { await f.close(); }
});

test('counts UTF-8 bytes and reports every oversized filename safely', async () => {
  const f = await fixture();
  try {
    const names = ['space name.ts', 'line\nbreak.ts', '-leading.ts', '冒号:文档.md'];
    for (const name of names) {
      await f.write(name, '界'.repeat(6667));
      f.git('add', '--', name);
    }
    const result = f.check();
    assert.equal(result.status, 1);
    for (const name of names) assert.ok(result.stderr.includes(`${JSON.stringify(name)}: 5000.25 tokens (20001 bytes)`));
  } finally { await f.close(); }
});

test('existing oversized files and staged deletions pass; renamed oversized files fail', async () => {
  const f = await fixture();
  try {
    for (const name of ['old.ts', 'delete.ts']) await f.write(name, 'x'.repeat(25000));
    f.git('add', '--', 'old.ts', 'delete.ts');
    assert.equal(f.commit(true).status, 0);
    assert.equal(f.check().status, 0);
    f.git('rm', '--', 'delete.ts');
    assert.equal(f.check().status, 0);
    f.git('mv', 'old.ts', 'renamed.ts');
    const result = f.check();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /renamed\.ts/);
    assert.doesNotMatch(result.stderr, /old\.ts|delete\.ts/);
  } finally { await f.close(); }
});

test('symlinks and submodules are not treated as authored file contents', async () => {
  const f = await fixture();
  try {
    await f.write('target.ts', 'x'.repeat(25000));
    await symlink('target.ts', `${f.directory}/link.ts`);
    f.git('add', '--', 'link.ts');
    assert.equal(f.commit().status, 0);
    const commit = f.git('rev-parse', 'HEAD').trim();
    f.git('update-index', '--add', '--cacheinfo', `160000,${commit},submodule`);
    assert.equal(f.check().status, 0);
  } finally { await f.close(); }
});
