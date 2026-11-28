import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'conditional-spreads');
  for (const folder of ['app', 'tests', 'scripts']) await mkdir(`${directory}/${folder}`, { recursive: true });
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-conditional-spreads.mjs')],
        { cwd: directory, encoding: 'utf8', timeout: 10000 },
      ),
  };
}

test('the conditional spread check rejects a property spread from && or from a ternary with an empty object, naming file and line', async context => {
  const f = await fixture(context);
  await f.write(
    'app/main/launch.ts',
    [
      'const plain = { cleanup };',
      'const viaAnd = { ...(cleanup && { cleanup }) };',
      'const viaTernary = { ...(owner ? { owner } : {}) };',
      'const viaEmptyFirst = { ...(cursor === null ? {} : { after: cursor }) };',
    ].join('\n'),
  );
  await f.write(
    'app/renderer/Page.tsx',
    'export const page = <Page {...(category && { initialCategory: category })} />;',
  );
  await f.write('scripts/run.mjs', "const env = { ...(reopen ? { REOPEN: '1' } : {}) };");

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  for (const line of [2, 3, 4]) assert.match(result.stderr, new RegExp(`^app/main/launch\\.ts:${line}:`, 'm'));
  assert.doesNotMatch(result.stderr, /launch\.ts:1:/);
  assert.match(result.stderr, /^app\/renderer\/Page\.tsx:1:/m);
  assert.match(result.stderr, /^scripts\/run\.mjs:1:/m);
});

test('the conditional spread check passes plain properties, spreads of whole objects and array spreads', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/values.test.ts',
    [
      'const named = { cleanup, owner: owner ?? undefined };',
      'const merged = { ...defaults, ...(overrides ?? defaults) };',
      'const picked = { ...(wide ? wideLayout : narrowLayout) };',
      'const args = [...(boundary < 0 ? [] : rest), ...(flag && [flag])];',
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
});
