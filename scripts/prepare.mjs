import { access, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
await access(binary);
const result = spawnSync(binary, ['-e', `
  require('node:sqlite');
  const pty = require('node-pty').spawn('/usr/bin/true', [], { env: process.env });
  pty.onExit(({ exitCode }) => process.exit(exitCode));
`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 10000 });
if (result.status !== 0) throw new Error('Runtime preparation failed. Run npm ci, then npm run rebuild:terminal before launching.');
console.log('Electron, SQLite and the native PTY are ready.');
