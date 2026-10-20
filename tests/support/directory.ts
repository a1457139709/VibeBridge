import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { TestContext } from 'node:test';

export async function testDirectory(context: TestContext, scope: string) {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(resolve('work', `${scope}-`));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
