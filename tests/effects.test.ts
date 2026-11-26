import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'effects');
  const write = async (file: string, source: string) => {
    await mkdir(dirname(`${directory}/${file}`), { recursive: true });
    await writeFile(`${directory}/${file}`, source);
  };
  return {
    write,
    baseline: (counts: Record<string, number>) => write('scripts/effect-baseline.json', JSON.stringify(counts)),
    storedBaseline: async () => JSON.parse(await readFile(`${directory}/scripts/effect-baseline.json`, 'utf8')),
    run: (...args: string[]) =>
      spawnSync(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath, [resolve('scripts/check-effects.mjs'), ...args], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10000,
      }),
  };
}

const reported = (stderr: string) =>
  [...stderr.matchAll(/^(\S+): (\d+) effects, (\d+) allowed \(lines ([\d, ]+)\)$/gm)].map(
    ([, file, count, allowed, lines]) => [file, Number(count), Number(allowed), lines],
  );

test('the effect check counts every reference to the React effect hooks in renderer files, naming file and line', async context => {
  const f = await fixture(context);
  await f.write(
    'app/renderer/settings/View.tsx',
    [
      "import { useEffect, useLayoutEffect as useBeforePaint, useState } from 'react';",
      'export function View() {',
      '  useEffect(() => {}, []);',
      '  useBeforePaint(() => {});',
      '  const [count] = useState(0);',
      '  return count;',
      '}',
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(reported(result.stderr), [['app/renderer/settings/View.tsx', 2, 0, '3, 4']]);
  assert.match(result.stderr, /CODING_STANDARDS\.md/);
});

test('the effect check counts namespace and default access and a hook passed or assigned as a value', async context => {
  const f = await fixture(context);
  await f.write(
    'app/renderer/forge/Rows.tsx',
    [
      "import * as React from 'react';",
      'React.useEffect(() => {});',
      'const before = React.useLayoutEffect;',
      'React.useState(0);',
    ].join('\n'),
  );
  await f.write(
    'app/renderer/forge/Detail.tsx',
    [
      "import React, { useEffect } from 'react';",
      'React.useLayoutEffect(() => {});',
      'const hooks = [useEffect];',
      'register(useEffect);',
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(reported(result.stderr), [
    ['app/renderer/forge/Detail.tsx', 3, 0, '2, 3, 4'],
    ['app/renderer/forge/Rows.tsx', 2, 0, '2, 3'],
  ]);
});

test('the effect check counts hooks destructured from React, re-exported from React and reached through import()', async context => {
  const f = await fixture(context);
  await f.write(
    'app/renderer/forge/Destructured.tsx',
    [
      "import React from 'react';",
      'const { useEffect, useLayoutEffect: useBeforePaint, useState } = React;',
      'useEffect(() => {});',
      'useBeforePaint(() => {});',
      'useState(0);',
    ].join('\n'),
  );
  await f.write(
    'app/renderer/forge/Reexported.ts',
    ["export { useEffect } from 'react';", "export { useLayoutEffect as useBeforePaint, useState } from 'react';"].join(
      '\n',
    ),
  );
  await f.write(
    'app/renderer/forge/Dynamic.ts',
    [
      "const react = await import('react');",
      'react.useEffect(() => {});',
      "const { useLayoutEffect } = await import('react');",
      'useLayoutEffect(() => {});',
      "void import('react').then(module => module.useEffect);",
      "(await import('react')).useLayoutEffect(() => {});",
      "const { useState } = await import('react');",
    ].join('\n'),
  );

  const result = f.run();

  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(reported(result.stderr), [
    ['app/renderer/forge/Destructured.tsx', 2, 0, '3, 4'],
    ['app/renderer/forge/Dynamic.ts', 4, 0, '2, 4, 5, 6'],
    ['app/renderer/forge/Reexported.ts', 2, 0, '1, 2'],
  ]);
});

test('the effect check ignores the effects directory, other files and same-named hooks not from React', async context => {
  const f = await fixture(context);
  await f.write(
    'app/renderer/common/effects/window-events.ts',
    "import { useEffect, useLayoutEffect } from 'react';\nuseEffect(() => {});\nuseLayoutEffect(() => {});\n",
  );
  await f.write(
    'app/renderer/forge/Local.tsx',
    [
      "import { useState } from 'react';",
      "import { useLayoutEffect } from './effects';",
      'function useEffect(run: () => void) {',
      '  run();',
      '}',
      'useEffect(() => {});',
      'useLayoutEffect(() => {});',
      'useState(0);',
    ].join('\n'),
  );
  await f.write(
    'app/renderer/forge/Shadowed.tsx',
    [
      "import { useEffect } from 'react';",
      'export const run = (useEffect: () => void) => useEffect();',
      'export const other = { useEffect: 1 }.useEffect;',
    ].join('\n'),
  );
  await f.write('app/main/window.ts', "import { useEffect } from 'react';\nuseEffect(() => {});\n");
  await f.write('tests/components/View.test.tsx', "import { useEffect } from 'react';\nuseEffect(() => {});\n");

  const result = f.run();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('the effect check holds each file to its baseline and only ever lowers it', async context => {
  const f = await fixture(context);
  const effects = (count: number) => `import { useEffect } from 'react';\n${'useEffect(() => {});\n'.repeat(count)}`;
  await f.write('app/renderer/kept.tsx', effects(2));
  await f.write('app/renderer/shrunk.tsx', effects(1));
  await f.write('app/renderer/grown.tsx', effects(2));
  await f.write('app/renderer/new.tsx', effects(1));
  await f.baseline({
    'app/renderer/kept.tsx': 2,
    'app/renderer/shrunk.tsx': 3,
    'app/renderer/grown.tsx': 1,
    'app/renderer/gone.tsx': 1,
  });

  const checked = f.run();

  assert.equal(checked.status, 1);
  assert.deepEqual(reported(checked.stderr), [
    ['app/renderer/grown.tsx', 2, 1, '2, 3'],
    ['app/renderer/new.tsx', 1, 0, '2'],
  ]);
  assert.match(checked.stderr, /^app\/renderer\/shrunk\.tsx: 1 effects, baseline 3$/m);
  assert.match(checked.stderr, /^app\/renderer\/gone\.tsx: 0 effects, baseline 1$/m);
  assert.match(checked.stderr, /npm run check:effects -- --update/);
  assert.doesNotMatch(checked.stderr, /app\/renderer\/kept\.tsx/);

  const updated = f.run('--update');

  assert.equal(updated.status, 1);
  assert.deepEqual(await f.storedBaseline(), {
    'app/renderer/kept.tsx': 2,
    'app/renderer/shrunk.tsx': 1,
    'app/renderer/grown.tsx': 1,
  });
  assert.deepEqual(reported(updated.stderr), [
    ['app/renderer/grown.tsx', 2, 1, '2, 3'],
    ['app/renderer/new.tsx', 1, 0, '2'],
  ]);
  assert.doesNotMatch(updated.stderr, /baseline/);
});
