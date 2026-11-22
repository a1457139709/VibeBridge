import { execFile } from 'node:child_process';

export function originUrl(directory: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile('git', ['-C', directory, 'remote', 'get-url', 'origin'], { timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : stdout.trim() || null),
    );
  });
}
