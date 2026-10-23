import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const list = args.includes('--list');
const files = args.filter(arg => arg !== '--list');
const claude = process.env.VIBEBRIDGE_TEST_CLAUDE === '1';
const claudeSuite = file => basename(file).startsWith('claude-');
if (claude && (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS'
  || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch')) {
  throw new Error('Claude checks run only through the manual Checks workflow on GitHub-hosted macOS.');
}
if (!claude && files.some(claudeSuite)) throw new Error('Enable Claude tests in the manual Checks workflow on GitHub.');
const entries = files.length ? files : (await readdir('tests')).filter(f => f.endsWith('.test.ts') && (claude || !claudeSuite(f))).map(f => `tests/${f}`);
if (!entries.length) throw new Error('No module tests found.');
if (list) { console.log(entries.join('\n')); process.exit(0); }
await mkdir('work/module-tests', { recursive: true });
const directory = await mkdtemp(resolve('work/module-tests/run-'));
try {
  await build({ entryPoints: entries, outdir: directory, bundle: true, platform: 'node',
    format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty', 'electron'] });
  await build({ entryPoints: { storage: 'app/main/storage-worker.ts', terminal: 'app/terminal/host.ts', 'codex-hook': 'app/main/codex-hook.ts', 'claude-hook': 'app/main/claude-hook.ts', 'workbench-process': 'tests/fixtures/workbench-process.ts' }, outdir: directory, bundle: true,
    platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['node-pty'] });
  const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
  const result = spawnSync(binary, ['--test', ...entries.map(f => resolve(directory, basename(f).replace('.ts', '.cjs')))],
    { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VIBEBRIDGE_TEST_NODE: process.execPath } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
