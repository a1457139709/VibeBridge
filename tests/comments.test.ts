import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'comments');
  const write = async (file: string, source: string) => {
    await mkdir(dirname(`${directory}/${file}`), { recursive: true });
    await writeFile(`${directory}/${file}`, source);
  };
  return {
    write,
    baseline: (counts: Record<string, number>) => write('scripts/comment-baseline.json', JSON.stringify(counts)),
    storedBaseline: async () => JSON.parse(await readFile(`${directory}/scripts/comment-baseline.json`, 'utf8')),
    run: (...args: string[]) =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-comments.mjs'), ...args],
        {
          cwd: directory,
          encoding: 'utf8',
          timeout: 10000,
        },
      ),
  };
}

test('the comment check rejects every kind of comment in scripts, JSX and styles', async context => {
  const f = await fixture(context);
  await f.write('app/line.ts', 'const a = 1; // trailing\n');
  await f.write('app/block.ts', '/** JSDoc */\nexport const b = 2;\n');
  await f.write('app/view.tsx', 'export const v = <div>{/* jsx */}</div>;\n');
  await f.write('tests/fixture.cjs', '#!/usr/bin/env node\n/* block */\nmodule.exports = 1;\n');
  await f.write('app/style.css', '.a { content: "/* not a comment */"; }\n/* a comment */\n');
  await f.write('vite.config.ts', '// root config\nexport default {};\n');

  const result = f.run();

  assert.equal(result.status, 1);
  const reported = [...result.stderr.matchAll(/^(\S+): (\d+) comments, 0 allowed \(lines ([\d, ]+)\)$/gm)].map(
    ([, file, count, lines]) => [file, Number(count), lines],
  );
  assert.deepEqual(reported, [
    ['app/block.ts', 1, '1'],
    ['app/line.ts', 1, '1'],
    ['app/style.css', 1, '2'],
    ['app/view.tsx', 1, '1'],
    ['tests/fixture.cjs', 1, '2'],
    ['vite.config.ts', 1, '1'],
  ]);
});

test('the comment check rejects lint suppression directives, so lint exceptions live in the oxlint config', async context => {
  const f = await fixture(context);
  await f.write('app/next-line.ts', '// oxlint-disable-next-line no-restricted-imports\nexport const n = 1;\n');
  await f.write('app/disabled.ts', '/* oxlint-disable */\nexport const d = 1;\n/* oxlint-enable */\n');

  const result = f.run();

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^app\/next-line\.ts: 1 comments, 0 allowed \(lines 1\)$/m);
  assert.match(result.stderr, /^app\/disabled\.ts: 2 comments, 0 allowed \(lines 1, 3\)$/m);
});

test('the comment check accepts code without comments, tool directives, strings and dependencies', async context => {
  const f = await fixture(context);
  await f.write('app/clean.ts', "export const url = 'http://example.com/*path*/';\n");
  await f.write('app/directive.ts', '// @ts-expect-error -- checked by the test\nexport const d: number = "x";\n');
  await f.write('app/ignored.css', '/* prettier-ignore */\n.a { color: red; }\n');
  await f.write('app/node_modules/package/index.js', '// a dependency\n');
  await f.write('dist/bundle.js', '// a build output\n');

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
});

test('the comment check holds each file to its baseline and only ever lowers it', async context => {
  const f = await fixture(context);
  await f.write('app/kept.ts', '// one\n// two\nexport {};\n');
  await f.write('app/shrunk.ts', '// one\nexport {};\n');
  await f.write('app/grown.ts', '// one\n// two\nexport {};\n');
  await f.baseline({ 'app/kept.ts': 2, 'app/shrunk.ts': 3, 'app/grown.ts': 1, 'app/gone.ts': 1 });

  const checked = f.run();

  assert.equal(checked.status, 1);
  assert.match(checked.stderr, /^app\/grown\.ts: 2 comments, 1 allowed/m);
  assert.match(checked.stderr, /^app\/shrunk\.ts: 1 comments, baseline 3$/m);
  assert.match(checked.stderr, /^app\/gone\.ts: 0 comments, baseline 1$/m);
  assert.doesNotMatch(checked.stderr, /app\/kept\.ts/);

  const updated = f.run('--update');

  assert.equal(updated.status, 1);
  assert.deepEqual(await f.storedBaseline(), { 'app/kept.ts': 2, 'app/shrunk.ts': 1, 'app/grown.ts': 1 });
  assert.match(updated.stderr, /^app\/grown\.ts: 2 comments, 1 allowed/m);
  assert.doesNotMatch(updated.stderr, /baseline/);
});
