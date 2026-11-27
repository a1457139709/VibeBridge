import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'empty-catch-callbacks');
  for (const folder of ['app', 'tests', 'scripts']) await mkdir(`${directory}/${folder}`, { recursive: true });
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-empty-catch-callbacks.mjs')],
        { cwd: directory, encoding: 'utf8', timeout: 10000 },
      ),
  };
}

test('the empty catch callback check rejects an empty arrow or function callback, naming file and line', async context => {
  const f = await fixture(context);
  await f.write(
    'app/main/save.ts',
    ['save().catch(error => report(error));', 'save().catch(() => {});', 'save().catch(function () {});'].join('\n'),
  );
  await f.write('scripts/build.mjs', 'build().catch(() => {});');

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^app\/main\/save\.ts:2:/m);
  assert.match(result.stderr, /^app\/main\/save\.ts:3:/m);
  assert.doesNotMatch(result.stderr, /save\.ts:1:/);
  assert.match(result.stderr, /^scripts\/build\.mjs:1:/m);
});

test('the empty catch callback check passes callbacks that handle the error and empty functions elsewhere', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/teardown.test.ts',
    ['run(() => {});', 'save().then(() => {});', 'save().catch(error => report(error));'].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
});
