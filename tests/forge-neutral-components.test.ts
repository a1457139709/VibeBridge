import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'forge-neutral-components');
  await mkdir(`${directory}/tests/components`, { recursive: true });
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-forge-neutral-components.mjs')],
        {
          cwd: directory,
          encoding: 'utf8',
          timeout: 10000,
        },
      ),
  };
}

test('the forge-neutral components check rejects a GitHub Forge ID literal, naming file and line', async context => {
  const f = await fixture(context);
  await f.write('tests/components/View.test.tsx', ["const ok = 'test-forge';", "const forge = 'github';"].join('\n'));

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^tests\/components\/View\.test\.tsx:2:/m);
  assert.doesNotMatch(result.stderr, /View\.test\.tsx:1:/);
  assert.match(result.stderr, /tests\/components\/support\/forge\.ts/);
});

test('the forge-neutral components check rejects the GitHub host and name in string and template literals', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/support/links.tsx',
    [
      'const url = `https://github.com/${owner}/${name}`;',
      'const pull = `${testForgeUrl}/a/b/pull/${n}/files?from=github.com`;',
      "const heading = 'GitHub';",
      "const install = 'https://cli.github.com';",
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  for (const line of [1, 2, 3, 4])
    assert.match(result.stderr, new RegExp(`^tests/components/support/links\\.tsx:${line}:`, 'm'));
});

test('the forge-neutral components check rejects the GitHub login command and GitHub-named identifiers and imports', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/Setup.test.tsx',
    [
      "const command = 'gh auth login';",
      "import { githubForge } from './support/forge';",
      'const view = { capabilities: GITHUB_CAPABILITIES };',
      'function renderWithGitHub() {}',
      "test('works without gh', () => {});",
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  for (const line of [1, 2, 3, 4])
    assert.match(result.stderr, new RegExp(`^tests/components/Setup\\.test\\.tsx:${line}:`, 'm'));
  assert.doesNotMatch(result.stderr, /Setup\.test\.tsx:5:/);
});

test('the forge-neutral components check passes clean component tests and leaves files outside them unscanned', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/View.test.tsx',
    [
      "import { testForgeRepository, testForgeUrl } from './support/forge';",
      'const url = `${testForgeUrl}/acme/app/pull/1`;',
    ].join('\n'),
  );
  await f.write('tests/github.test.ts', "const host = 'github.com';");
  await f.write('app/main/forge/github.ts', "export const githubForge = 'github';");

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('the forge-neutral components check rejects GitHub in JSX text', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/Heading.test.tsx',
    ['const ok = <p>Test Forge</p>;', 'const heading = <p>GitHub</p>;'].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /^tests\/components\/Heading\.test\.tsx:2:/m);
  assert.doesNotMatch(result.stderr, /Heading\.test\.tsx:1:/);
});
