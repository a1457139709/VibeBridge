// THROWAWAY: build the local renderer and open a real Electron/PTY experiment.
import { build } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
// Optional one-launch override; otherwise use the prototype's saved preference.
const startupTheme = process.argv.find(arg => /^--theme=(system|dark|light)$/.test(arg))?.split('=')[1];
const runtime = mkdtempSync(path.join(tmpdir(), 'vibebridge-terminal-'));
const cwd = path.join(runtime, 'workspace');
mkdirSync(cwd);
writeFileSync(path.join(cwd, 'README.md'), '# VibeBridge 终端体验目录\n\n这是临时示例目录，供 Claude Code、Codex CLI 和 pi 交互使用。\n可以阅读 example.ts、解释代码、输出较长中文回答。\n此目录会保留到系统清理临时文件时；工作台不保存终端记录。\n');
writeFileSync(path.join(cwd, 'example.ts'), 'export function greeting(name: string) {\n  return `你好，${name}！`;\n}\n\nconsole.log(greeting("VibeBridge"));\n');
const cleanEnv = { ...process.env };
for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_CHANNEL_FD', 'CLAUDECODE']) delete cleanEnv[key];
function executable(command) {
  for (const directory of (cleanEnv.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}
const agents = [['codex', 'Codex'], ['claude', 'Claude Code'], ['pi', 'pi']].map(([id, name]) => {
  const command = executable(id);
  const result = command && spawnSync(command, ['--version'], { env: cleanEnv, encoding: 'utf8', timeout: 10000 });
  return { id, name, path: command, version: result?.stdout?.trim() || '未检测到版本' };
});
const nativeCheck = spawnSync(electron, ['-e', 'require("node-pty")'], {
  cwd: root, env: { ...cleanEnv, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15000,
});
if (nativeCheck.status !== 0) {
  console.log('为当前 Electron 编译 node-pty…');
  const { rebuild } = await import('@electron/rebuild');
  const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  await rebuild({ buildPath: root, electronVersion, onlyModules: ['node-pty'], force: true });
}
writeFileSync(path.join(runtime, 'launch.json'), JSON.stringify({ cwd, agents, parentPid: process.pid, startupTheme }));
await build({ configFile: path.join(here, 'vite.config.ts') });
const args = [path.join(here, 'main.prototype.cjs')];
const child = spawn(electron, args, {
  cwd: root, stdio: 'inherit', env: { ...cleanEnv, VIBEBRIDGE_PROTOTYPE_RUNTIME: runtime },
});
console.log(`真实终端原型 · 临时目录：${cwd}`);
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill('SIGTERM'));
