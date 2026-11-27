import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'empty-object-literals');
  for (const folder of ['app', 'tests', 'scripts']) await mkdir(`${directory}/${folder}`, { recursive: true });
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-empty-object-literals.mjs')],
        { cwd: directory, encoding: 'utf8', timeout: 10000 },
      ),
  };
}

test('the empty object literal check rejects an untyped variable initialized to {}, naming file and line', async context => {
  const f = await fixture(context);
  await f.write(
    'app/main/requests.ts',
    ['const typed: Record<string, number> = {};', 'const request = {};', 'let pending = {};'].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^app\/main\/requests\.ts:2:/m);
  assert.match(result.stderr, /^app\/main\/requests\.ts:3:/m);
  assert.doesNotMatch(result.stderr, /requests\.ts:1:/);
});

test('the empty object literal check passes typed and non-empty literals and leaves JavaScript files alone', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/values.test.ts',
    ['const values: Record<string, string> = {};', "const named = { id: 'a' };"].join('\n'),
  );
  await f.write('scripts/build.mjs', 'const lowered = {};');

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
});
