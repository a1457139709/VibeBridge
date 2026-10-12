import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const packaged = process.argv.includes('--packaged');
const appearance = process.argv.includes('--appearance');
const codex = process.argv.includes('--codex');
const projectManagement = process.argv.includes('--project-management');
const setup = process.argv.includes('--setup');
const panels = process.argv.includes('--panels');
const noticeStartup = process.argv.includes('--notices-startup');
const settingsMigration = process.argv.includes('--settings-migration');
const settingsDrafts = process.argv.includes('--settings-drafts');
const navigation = process.argv.includes('--navigation');
// The test harness needs Electron's default-app entry; packaged product files and native modules
// are still loaded exclusively from the bundle when --packaged is selected.
const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
await mkdir('work/issue-24', { recursive: true });
const directory = await mkdtemp(resolve('work/issue-24/desktop-'));
const environment = { ...process.env, VIBEBRIDGE_TEST_NODE: process.execPath, VIBEBRIDGE_TEST_DATA: directory,
  ...(appearance ? { VIBEBRIDGE_TEST_APPEARANCE: '1' } : {}),
  ...(codex ? { VIBEBRIDGE_TEST_CODEX: '1' } : {}),
  ...(noticeStartup ? { VIBEBRIDGE_TEST_NOTICE_STARTUP: '1' } : {}),
  ...(settingsMigration ? { VIBEBRIDGE_TEST_SETTINGS_MIGRATION: '1' } : {}),
  ...(settingsDrafts ? { VIBEBRIDGE_TEST_SETTINGS_DRAFTS: '1' } : {}),
  ...(navigation ? { VIBEBRIDGE_TEST_NAVIGATION: '1' } : {}),
  ...(projectManagement ? { VIBEBRIDGE_TEST_PROJECT_MANAGEMENT: '1' } : {}),
  ...(setup ? { VIBEBRIDGE_TEST_SETUP: '1' } : {}),
  ...(panels ? { VIBEBRIDGE_TEST_PANELS: '1' } : {}),
  PATH: '/usr/bin:/bin',
  VIBEBRIDGE_TEST_ENTRY: packaged ? resolve(process.env.VIBEBRIDGE_TEST_APP ?? 'outputs/VibeBridge.app', 'Contents/Resources/app/dist/main.cjs') : resolve('dist/main.cjs') };
delete environment.ELECTRON_RUN_AS_NODE;
try {
  for (const reopen of appearance || codex || setup || noticeStartup || projectManagement || settingsDrafts || settingsMigration ? [false] : [false, true]) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(binary, ['tests/desktop.cjs'], { env: { ...environment, ...(reopen ? { VIBEBRIDGE_TEST_REOPEN: '1' } : {}) }, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', resolve);
    });
    if (code !== 0) { process.exitCode = code ?? 1; break; }
  }
} finally { await rm(directory, { recursive: true, force: true }); }
