import { cp, mkdir, readFile, writeFile, access, rm, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'darwin') throw new Error('Local packaging supports macOS only.');
const output = resolve('outputs/VibeBridge.app');
await access('dist/main.cjs');
await mkdir('outputs', { recursive: true });
await rm(output, { recursive: true, force: true });
await cp('node_modules/electron/dist/Electron.app', output, { recursive: true, verbatimSymlinks: true });
const resources = `${output}/Contents/Resources/app`;
await mkdir(resources, { recursive: true });
await cp('dist', `${resources}/dist`, { recursive: true });
const pty = `${resources}/node_modules/node-pty`;
await mkdir(`${pty}/build/Release`, { recursive: true });
await cp('node_modules/node-pty/lib', `${pty}/lib`, { recursive: true, filter: path => !path.endsWith('.map') && !path.includes('.test.') });
await cp('node_modules/node-pty/package.json', `${pty}/package.json`);
let nativeDirectory;
for (const candidate of ['build/Release', 'build/Debug', `prebuilds/darwin-${process.arch}`]) {
  try { await access(`node_modules/node-pty/${candidate}/pty.node`); nativeDirectory = candidate; break; } catch { /* next native build */ }
}
if (!nativeDirectory) throw new Error('Prepare the native PTY before packaging.');
for (const file of ['pty.node', 'spawn-helper']) await cp(`node_modules/node-pty/${nativeDirectory}/${file}`, `${pty}/build/Release/${file}`);
await chmod(`${pty}/build/Release/spawn-helper`, 0o755);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile(`${resources}/package.json`, JSON.stringify({ name: pkg.name, productName: 'VibeBridge', version: pkg.version, main: 'dist/main.cjs' }));
const plist = `${output}/Contents/Info.plist`;
for (const [key, value] of Object.entries({ CFBundleDisplayName: 'VibeBridge', CFBundleName: 'VibeBridge', CFBundleIdentifier: 'local.vibebridge.app', CFBundleShortVersionString: pkg.version, CFBundleVersion: pkg.version })) {
  const result = spawnSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Could not set ${key}`);
}
const signed = spawnSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', output], { stdio: 'inherit' });
if (signed.status !== 0) throw new Error('Local ad hoc signing failed');
console.log(`Packaged ${output}`);
