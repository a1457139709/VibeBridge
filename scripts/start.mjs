import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const binary = resolve('node_modules/electron/dist', (await readFile('node_modules/electron/path.txt', 'utf8')).trim());
await access(binary);
await access('dist/main.cjs');
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, ['.'], { env: environment, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
