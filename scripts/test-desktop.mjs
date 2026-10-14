import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const packaged = args.includes('--packaged');
const all = args.includes('--all');
const list = args.includes('--list');
const names = args.filter(arg => !['--packaged', '--all', '--list'].includes(arg)).map(arg => arg.replace(/^--/, ''));
if (names.length > 1 || (all && names.length)) throw new Error('Select one desktop suite or --all.');

const suites = (await readdir('tests/desktop', { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.cjs'))
  .map(entry => {
    const file = resolve('tests/desktop', entry.name);
    const definition = require(file);
    if (!definition || typeof definition.run !== 'function'
      || (definition.reopen !== undefined && typeof definition.reopen !== 'function')
      || (definition.configure !== undefined && typeof definition.configure !== 'function')
      || (definition.manual !== undefined && (typeof definition.manual !== 'string' || !definition.manual.trim()))) {
      throw new Error(`Invalid desktop suite: ${file}`);
    }
    return { name: entry.name.slice(0, -'.test.cjs'.length), file, definition };
  }).sort((a, b) => a.name.localeCompare(b.name));

const selected = all ? suites.filter(suite => !suite.definition.manual)
  : list && !names.length ? suites : suites.filter(suite => suite.name === (names[0] ?? 'default'));
if (!selected.length) throw new Error(`No desktop suites found for ${all ? '--all' : names[0] ?? 'default'}.`);
if (list) {
  for (const suite of selected) console.log(`${suite.name}${suite.definition.manual ? ` (manual: ${suite.definition.manual})` : ''}`);
} else {
  // Packaged checks load product code from the bundle through Electron's test host.
  const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
  await mkdir('work/desktop-tests', { recursive: true });
  for (const suite of selected) {
    console.log(`\n=== Desktop suite: ${suite.name} ===`);
    const directory = await mkdtemp(resolve('work/desktop-tests', `${suite.name}-`));
    const environment = { ...process.env, VIBEBRIDGE_TEST_NODE: process.execPath, VIBEBRIDGE_TEST_DATA: directory,
      VIBEBRIDGE_TEST_SUITE: suite.file, PATH: '/usr/bin:/bin',
      VIBEBRIDGE_TEST_ENTRY: packaged ? resolve(process.env.VIBEBRIDGE_TEST_APP ?? 'outputs/VibeBridge.app', 'Contents/Resources/app/dist/main.cjs') : resolve('dist/main.cjs') };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.VIBEBRIDGE_TEST_REOPEN;
    try {
      for (const reopen of suite.definition.reopen ? [false, true] : [false]) {
        const code = await new Promise((resolve, reject) => {
          const child = spawn(binary, ['tests/desktop/support/harness.cjs'], {
            env: { ...environment, ...(reopen ? { VIBEBRIDGE_TEST_REOPEN: '1' } : {}) }, stdio: 'inherit',
          });
          child.on('error', reject);
          child.on('exit', resolve);
        });
        if (code !== 0) { process.exitCode = code ?? 1; break; }
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
    if (process.exitCode) {
      console.error(`FAIL: desktop suite ${suite.name}`);
      break;
    }
    console.log(`PASS: desktop suite ${suite.name}`);
  }
}
