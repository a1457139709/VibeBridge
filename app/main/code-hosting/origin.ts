import { execFile } from 'node:child_process';

/** The URL the project directory's `origin` remote fetches from, or null when there is none or git cannot tell. */
export function originUrl(directory: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['-C', directory, 'remote', 'get-url', 'origin'], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
  });
}
