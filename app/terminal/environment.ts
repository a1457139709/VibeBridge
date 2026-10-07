import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';

const execute = promisify(execFile);
export async function commandEnvironment(): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh';
  // A login shell is used only to read the user's environment. Agents never run through it.
  const { stdout } = await execute(shell, ['-ilc', "printf '\\0VIBEBRIDGE_ENV\\0'; /usr/bin/env -0"], { timeout: 5000, maxBuffer: 1024 * 1024 });
  const marker = '\0VIBEBRIDGE_ENV\0';
  if (!stdout.includes(marker)) throw new Error('无法读取本机命令环境');
  const environment: Record<string, string> = {};
  for (const entry of stdout.slice(stdout.indexOf(marker) + marker.length).split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_CHANNEL_FD;
  delete environment.NODE_CHANNEL_SERIALIZATION_MODE;
  environment.TERM = 'xterm-256color';
  environment.COLORTERM = 'truecolor';
  return environment;
}

export async function executable(command: string, environment: Record<string, string>): Promise<string> {
  const paths = isAbsolute(command) ? [command] : command.includes('/') ? [] : (environment.PATH || '').split(':').filter(isAbsolute).map(path => join(path, command));
  for (const path of paths) {
    try { await access(path, constants.X_OK); if ((await stat(path)).isFile()) return path; } catch { /* next PATH entry */ }
  }
  throw new Error('Agent 无法启动');
}
