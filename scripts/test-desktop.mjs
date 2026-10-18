import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { basename, resolve } from 'node:path';

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

const selected = list && !names.length ? suites : all || !names.length ? suites.filter(suite => !suite.definition.manual)
  : suites.filter(suite => suite.name === names[0]);
if (!selected.length) throw new Error(`No desktop suites found for ${names[0] ?? '--all'}.`);
if (list) {
  for (const suite of selected) console.log(`${suite.name}${suite.definition.manual ? ` (manual: ${suite.definition.manual})` : ''}`);
} else {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'macOS') {
    throw new Error('Desktop checks run on GitHub-hosted macOS only. Use the Checks workflow; run npm run check locally.');
  }
  // Packaged checks load product code from the bundle through Electron's test host.
  const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
  await mkdir('work/desktop-tests', { recursive: true });
  for (const suite of selected) {
    console.log(`\n=== Desktop suite: ${suite.name} ===`);
    const directory = await mkdtemp(resolve('work/desktop-tests', `${suite.name}-`));
    const artifacts = resolve('work/desktop-artifacts', basename(directory));
    let failed = false;
    const environment = { ...process.env, VIBEBRIDGE_TEST_NODE: process.execPath, VIBEBRIDGE_TEST_DATA: directory,
      VIBEBRIDGE_TEST_SUITE: suite.file, PATH: '/usr/bin:/bin',
      VIBEBRIDGE_TEST_ENTRY: packaged ? resolve(process.env.VIBEBRIDGE_TEST_APP ?? 'outputs/VibeBridge.app', 'Contents/Resources/app/dist/main.cjs') : resolve('dist/main.cjs') };
    delete environment.ELECTRON_RUN_AS_NODE;
    delete environment.VIBEBRIDGE_TEST_REOPEN;
    try {
      for (const reopen of suite.definition.reopen ? [false, true] : [false]) {
        const evidence = resolve(artifacts, reopen ? 'reopen' : 'run');
        await mkdir(evidence, { recursive: true });
        const log = createWriteStream(resolve(evidence, 'process.log'));
        const code = await new Promise((resolve, reject) => {
          const child = spawn(binary, ['tests/desktop/support/harness.cjs'], {
            env: { ...environment, VIBEBRIDGE_TEST_EVIDENCE: evidence, ...(reopen ? { VIBEBRIDGE_TEST_REOPEN: '1' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
          });
          child.stdout.on('data', chunk => { process.stdout.write(chunk); log.write(chunk); });
          child.stderr.on('data', chunk => { process.stderr.write(chunk); log.write(chunk); });
          child.once('error', error => { log.write(String(error)); reject(error); });
          child.once('close', resolve);
        }).finally(async () => { log.end(); await finished(log); });
        if (code !== 0) { failed = true; process.exitCode = code ?? 1; break; }
      }
    } catch (error) { failed = true; throw error; }
    finally {
      await rm(directory, { recursive: true, force: true });
      if (!failed) await rm(artifacts, { recursive: true, force: true });
      else console.error(`Desktop diagnostics: ${artifacts}`);
    }
    if (process.exitCode) {
      console.error(`FAIL: desktop suite ${suite.name}`);
      break;
    }
    console.log(`PASS: desktop suite ${suite.name}`);
  }
}
