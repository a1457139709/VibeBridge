import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const files = process.argv.slice(2);
const entries = files.length ? files : (await readdir('tests/components'))
  .filter(file => file.endsWith('.test.tsx')).map(file => `tests/components/${file}`);
if (!entries.length) throw new Error('No component tests found.');
await mkdir('work/component-tests', { recursive: true });
const directory = await mkdtemp(resolve('work/component-tests/run-'));
try {
  await build({ entryPoints: entries, outdir: directory, bundle: true, platform: 'node',
    format: 'cjs', packages: 'external', outExtension: { '.js': '.cjs' } });
  const result = spawnSync(process.execPath, ['--test', ...entries.map(file => resolve(directory, basename(file).replace(/\.tsx$/, '.cjs')))],
    { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
