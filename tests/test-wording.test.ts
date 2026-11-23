import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'test-wording');
  await mkdir(`${directory}/tests`);
  const write = async (file: string, source: string) => {
    await mkdir(dirname(`${directory}/${file}`), { recursive: true });
    await writeFile(`${directory}/${file}`, source);
  };
  return {
    write,
    baseline: (counts: Record<string, number>) => write('scripts/test-wording-baseline.json', JSON.stringify(counts)),
    storedBaseline: async () => JSON.parse(await readFile(`${directory}/scripts/test-wording-baseline.json`, 'utf8')),
    run: (...args: string[]) =>
      spawnSync(
        process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
        [resolve('scripts/check-test-wording.mjs'), ...args],
        { cwd: directory, encoding: 'utf8', timeout: 10000 },
      ),
  };
}

const reported = (stderr: string) =>
  [...stderr.matchAll(/^(\S+): (\d+) wording queries, (\d+) allowed \(lines ([\d, ]+)\)$/gm)].map(
    ([, file, count, allowed, lines]) => [file, Number(count), Number(allowed), lines],
  );

test('the test wording check rejects text queries and hard-coded accessible names, naming file and line', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/View.test.tsx',
    [
      "screen.getByText('Saved');",
      'await within(row).findAllByText(/Open/);',
      "screen.getByRole('button', { name: 'Save' });",
      "screen.queryByRole('link', { name: /details/i });",
      "screen.getByRole('menuitem', { name: en ? 'Edit project' : '编辑项目' });",
      "screen.getByRole('button', { name: `Project menu: ${project.name}` });",
      "screen.getByLabelText('Blocked by #1');",
      'queryByText(value);',
    ].join('\n'),
  );
  await f.write(
    'tests/support/helpers.ts',
    "export const save = () => screen.findByRole('button', { name: 'Save' });\n",
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(reported(result.stderr), [
    ['tests/components/View.test.tsx', 8, 0, '1, 2, 3, 4, 5, 6, 7, 8'],
    ['tests/support/helpers.ts', 1, 0, '1'],
  ]);
  assert.match(result.stderr, /docs\/adr\/0009-tests-confirm-behaviour-not-wording\.md/);
});

test('the test wording check accepts localized names, structural queries, fixtures and desktop tests', async context => {
  const f = await fixture(context);
  await f.write(
    'tests/components/View.test.tsx',
    [
      "screen.getByRole('textbox', { name: t('localDirectory') });",
      "screen.getByRole('group', { name: t('subIssuesOf', { number: 10 }) });",
      "const titleOf = (name: string) => screen.getByRole('button', { name });",
      "screen.getAllByRole('row');",
      "screen.getByRole('button', { name: `${t('projectMenu')}${project.name}` });",
    ].join('\n'),
  );
  await f.write('tests/fixtures/workbench-process.ts', "screen.getByText('fixture');\n");
  await f.write('tests/desktop/menu.test.cjs', "screen.getByText('desktop');\n");

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('the test wording check holds each file to its baseline and only ever lowers it', async context => {
  const f = await fixture(context);
  await f.write('tests/kept.test.ts', "getByText('a');\ngetByText('b');\n");
  await f.write('tests/shrunk.test.ts', "getByText('a');\n");
  await f.write('tests/grown.test.ts', "getByText('a');\ngetByText('b');\n");
  await f.baseline({
    'tests/kept.test.ts': 2,
    'tests/shrunk.test.ts': 3,
    'tests/grown.test.ts': 1,
    'tests/gone.test.ts': 1,
  });

  const checked = f.run();

  assert.equal(checked.status, 1);
  assert.deepEqual(reported(checked.stderr), [['tests/grown.test.ts', 2, 1, '1, 2']]);
  assert.match(checked.stderr, /^tests\/shrunk\.test\.ts: 1 wording queries, baseline 3$/m);
  assert.match(checked.stderr, /^tests\/gone\.test\.ts: 0 wording queries, baseline 1$/m);
  assert.match(checked.stderr, /npm run check:test-wording -- --update/);
  assert.doesNotMatch(checked.stderr, /tests\/kept\.test\.ts/);

  const updated = f.run('--update');

  assert.equal(updated.status, 1);
  assert.deepEqual(await f.storedBaseline(), {
    'tests/kept.test.ts': 2,
    'tests/shrunk.test.ts': 1,
    'tests/grown.test.ts': 1,
  });
  assert.deepEqual(reported(updated.stderr), [['tests/grown.test.ts', 2, 1, '1, 2']]);
  assert.doesNotMatch(updated.stderr, /baseline/);
});
