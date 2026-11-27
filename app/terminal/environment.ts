import { message } from '../shared/messages';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { errorCode } from '../shared/caught-error';

const unusableCandidate = new Set<unknown>(['ENOENT', 'EACCES', 'ENOTDIR', 'ELOOP']);

const execute = promisify(execFile);
export async function readLoginEnvironment(): Promise<Record<string, string>> {
  const shell = process.env.SHELL || '/bin/zsh';
  const { stdout } = await execute(shell, ['-ilc', "printf '\\0VIBEBRIDGE_ENV\\0'; /usr/bin/env -0"], {
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  const marker = '\0VIBEBRIDGE_ENV\0';
  if (!stdout.includes(marker)) throw new Error(message('environmentFailed'));
  const environment: Record<string, string> = {};
  for (const entry of stdout.slice(stdout.indexOf(marker) + marker.length).split('\0')) {
    const separator = entry.indexOf('=');
    if (separator > 0) environment[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_CHANNEL_FD;
  delete environment.NODE_CHANNEL_SERIALIZATION_MODE;
  for (const name of Object.keys(environment)) if (name.startsWith('VIBEBRIDGE_')) delete environment[name];
  environment.TERM = 'xterm-256color';
  environment.COLORTERM = 'truecolor';
  return environment;
}

export async function resolveExecutable(command: string, environment: { PATH?: string }): Promise<string> {
  const paths = isAbsolute(command)
    ? [command]
    : command.includes('/')
      ? []
      : (environment.PATH || '')
          .split(':')
          .filter(isAbsolute)
          .map(path => join(path, command));
  for (const path of paths) {
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return path;
    } catch (error) {
      if (!unusableCandidate.has(errorCode(error))) throw error;
    }
  }
  throw new Error(message('launchFailed'));
}
