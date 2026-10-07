import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const packaged = process.argv.includes('--packaged');
// The test harness needs Electron's default-app entry; packaged product files and native modules
// are still loaded exclusively from the bundle when --packaged is selected.
const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
const directory = await mkdtemp(resolve('work/issue-24/desktop-'));
const environment = { ...process.env, VIBEBRIDGE_TEST_NODE: process.execPath, VIBEBRIDGE_TEST_DATA: directory,
  PATH: '/usr/bin:/bin',
  VIBEBRIDGE_TEST_ENTRY: packaged ? resolve('outputs/VibeBridge.app/Contents/Resources/app/dist/main.cjs') : resolve('dist/main.cjs') };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, ['tests/desktop.cjs'], { env: environment, stdio: 'inherit' });
child.on('exit', async code => { await rm(directory, { recursive: true, force: true }); process.exitCode = code ?? 1; });
