import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

// Builds a promise expression for a fixture's source, so this file holds no wait the check would report.
const promise = (body: string) => `new Promise(${body})`;

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'test-waits');
  await mkdir(`${directory}/tests`);
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () => spawnSync(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
      [resolve('scripts/check-test-waits.mjs')], { cwd: directory, encoding: 'utf8', timeout: 10000 }),
  };
}

test('test wait checks reject waiting a fixed time or a fixed number of frames, in code and in evaluated scripts', async context => {
  const f = await fixture(context);
  await f.write('tests/drops.test.ts', [
    `await ${promise('resolve => setTimeout(resolve, 300)')};`,
    `await evaluate('${promise('resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))')}');`,
    `await ${promise('done => { setTimeout(done, 50); }')};`,
    `const frames = \`${promise('resolve => requestAnimationFrame(() => setTimeout(resolve))')}\`;`,
  ].join('\n'));
  await f.write('tests/desktop/support/settle.cjs', `module.exports = evaluate => evaluate('${promise('r => requestAnimationFrame(r)')}');`);
  const result = f.run();
  assert.equal(result.status, 1, result.stderr);
  for (const line of [1, 2, 3, 4]) assert.ok(result.stderr.includes(`tests/drops.test.ts:${line}:`), result.stderr);
  assert.ok(result.stderr.includes('tests/desktop/support/settle.cjs:1:'), result.stderr);
});

test('test wait checks allow polling inside until, frame stubs, timeouts that reject, and fixture behaviour', async context => {
  const f = await fixture(context);
  await f.write('tests/desktop/support/until.cjs', [
    'module.exports = async function until(check) {',
    `  while (!(await check())) await ${promise('resolve => setTimeout(resolve, 30)')};`,
    '};',
  ].join('\n'));
  await f.write('tests/panels.test.ts', [
    'async function until(check: () => boolean) {',
    `  while (!check()) await ${promise('resolve => setTimeout(resolve, 20)')};`,
    '}',
    `const poll = { until: async (check: () => boolean) => { while (!check()) await ${promise('resolve => setTimeout(resolve, 20)')}; } };`,
    `const limit = ${promise("(_resolve, reject) => { setTimeout(() => reject(new Error('no answer')), 2000); }")};`,
    `const settled = () => ${promise('resolve => setImmediate(resolve)')};`,
  ].join('\n'));
  await f.write('tests/components/TrayPlacement.test.tsx', 'Object.assign(window, { requestAnimationFrame: () => 0, cancelAnimationFrame: () => {} });');
  await f.write('tests/fixtures/title-cli.cjs', `await ${promise('resolve => setTimeout(resolve, command.delay)')};`);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});
