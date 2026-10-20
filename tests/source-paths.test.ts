import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'source-paths');
  for (const root of ['app', 'tests', 'scripts']) await mkdir(`${directory}/${root}`);
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    read: (file: string) => readFile(`${directory}/${file}`, 'utf8'),
    run: () => spawnSync(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
      [resolve('scripts/check-source-paths.mjs')], { cwd: directory, encoding: 'utf8', timeout: 10000 }),
  };
}

test('source path checks reject task-named files and path literals, including templates and Windows paths', async context => {
  const f = await fixture(context);
  const task = ['issue', 123].join('-');
  const source = [
    `const data = 'work/${task}/navigation-';`,
    `const windows = ${JSON.stringify(`work\\${task}\\settings-`)};`,
    `const template = \`work/${task}/\${name}\`;`,
    `const suffix = \`\${root}/${task}/settings-\`;`,
    `const scope = '${task}';`,
    `const middle = \`\${root}/${task}/\${name}\`;`,
  ].join('\n');
  await f.write('tests/navigation.test.ts', source);
  await f.write(`app/${task}.ts`, 'export {};');
  await f.write('scripts/setup.cjs', `const data = 'work/${task.replace('-', '_')}/';`);
  const result = f.run();
  assert.equal(result.status, 1, result.stderr);
  for (const line of [1, 2, 3, 4, 5, 6]) assert.ok(result.stderr.includes(`tests/navigation.test.ts:${line}:`));
  assert.ok(result.stderr.includes(`app/${task}.ts:`));
  assert.match(result.stderr, /scripts\/setup\.cjs:1:/);
  assert.equal(await f.read('tests/navigation.test.ts'), source, 'checks leave source files unchanged');
});

test('source path checks allow feature names, issue links, comments and validation issue fields', async context => {
  const f = await fixture(context);
  const task = ['issue', 123].join('-');
  await f.write('tests/navigation.test.ts', [
    `// Regression from ${task}; the old path was work/${task}/.`,
    `const link = 'https://example.test/${task}';`,
    `const templateLink = \`https://\${host}/${task}/\${name}\`;`,
    `const description = 'Regression for ${task}';`,
    "const data = 'work/navigation-';",
    "const result = { issues: [{ field: 'shortcuts.nextPanel' }] };",
  ].join('\n'));
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});
