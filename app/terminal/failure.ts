import { writeFile } from 'node:fs/promises';

// One bounded diagnostic record, separate from settings and panel configuration.
export async function recordFailure(file: string, source: 'main' | 'terminal', message: string, cleanupError?: unknown) {
  await writeFile(file, JSON.stringify({ time: new Date().toISOString(), source, message: message.slice(0, 2048),
    ...(cleanupError ? { cleanupError: String(cleanupError).slice(0, 2048) } : {}) }, null, 2));
}
