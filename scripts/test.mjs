import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('work/issue-24/tests', { recursive: true });
const files = process.argv.slice(2);
const entries = files.length ? files : (await readdir('tests')).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
await build({ entryPoints: entries, outdir: 'work/issue-24/tests', bundle: true, platform: 'node',
  format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty', 'electron'] });
await build({ entryPoints: { storage: 'app/main/storage-worker.ts', terminal: 'app/terminal/host.ts' }, outdir: 'work/issue-24/tests', bundle: true,
  platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty'] });
const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
const result = spawnSync(binary, ['--test', ...entries.map(f => resolve('work/issue-24/tests', f.split('/').at(-1).replace('.ts', '.cjs')))],
  { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VIBEBRIDGE_TEST_NODE: process.execPath } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
