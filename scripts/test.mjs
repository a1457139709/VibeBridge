import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const files = process.argv.slice(2);
const entries = files.length ? files : (await readdir('tests')).filter(f => f.endsWith('.test.ts')).map(f => `tests/${f}`);
if (!entries.length) throw new Error('No module tests found.');
await mkdir('work/module-tests', { recursive: true });
const directory = await mkdtemp(resolve('work/module-tests/run-'));
try {
  await build({ entryPoints: entries, outdir: directory, bundle: true, platform: 'node',
    format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty', 'electron'] });
  await build({ entryPoints: { storage: 'app/main/storage-worker.ts', terminal: 'app/terminal/host.ts', 'codex-reporter': 'app/main/agent-status/codex/reporter.ts', 'claude-reporter': 'app/main/agent-status/claude/reporter.ts', 'workbench-process': 'tests/fixtures/workbench-process.ts' }, outdir: directory, bundle: true,
    platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty'] });
  const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
  await build({ entryPoints: { 'pi-reporter': 'app/main/agent-status/pi/reporter.ts' }, outdir: directory, bundle: true,
    platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
  const result = spawnSync(binary, ['--test', ...entries.map(f => resolve(directory, basename(f).replace('.ts', '.cjs')))],
    { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VIBEBRIDGE_TEST_NODE: process.execPath } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
