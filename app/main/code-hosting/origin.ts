import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { executable } from '../../terminal/environment';
import type { CommandEnvironment } from './platform';

const execute = promisify(execFile);

/** The URL of the directory's `origin` remote, or null when there is none or git cannot tell. */
export async function originUrl(directory: string, environment: CommandEnvironment): Promise<string | null> {
  try {
    const git = await executable('git', environment);
    const { stdout } = await execute(git, ['remote', 'get-url', 'origin'], { cwd: directory, env: environment, timeout: 10000 });
    return stdout.trim() || null;
  } catch { return null; }
}
