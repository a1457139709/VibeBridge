import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { testDirectory } from './directory';

/** An issue as GitHub's GraphQL API names its fields. */
export interface GhIssue {
  number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED';
  createdAt: string; labels: { name: string; color: string }[];
}

export interface GhState {
  account: string;
  repositories: string[];
  /** The issues of every listed repository, and the labels each repository defines. */
  issues?: GhIssue[];
  labels?: { name: string; color: string }[];
  /** `gh` fails every command with this exit code and output. */
  failure?: { code: number; stdout?: string; stderr?: string };
}

/** Puts tests/fixtures/gh-cli.cjs first on PATH as `gh` for this test; `set` changes the account's state.
 * `uninstall` leaves PATH with no `gh` at all. PATH is restored after the test. */
export async function ghDouble(context: TestContext, state: GhState) {
  const directory = await testDirectory(context, 'gh-double');
  const bin = join(directory, 'bin'), empty = join(directory, 'empty');
  await mkdir(bin); await mkdir(empty);
  const file = join(directory, 'state.json');
  const program = join(bin, 'gh');
  await writeFile(program, `#!/bin/sh\nexec '${process.env.VIBEBRIDGE_TEST_NODE}' '${resolve('tests/fixtures/gh-cli.cjs')}' "$@"\n`);
  await chmod(program, 0o755);
  const path = process.env.PATH, stateFile = process.env.VIBEBRIDGE_GH_DOUBLE;
  context.after(() => {
    process.env.PATH = path;
    if (stateFile === undefined) delete process.env.VIBEBRIDGE_GH_DOUBLE; else process.env.VIBEBRIDGE_GH_DOUBLE = stateFile;
  });
  process.env.PATH = `${bin}:${path}`;
  process.env.VIBEBRIDGE_GH_DOUBLE = file;
  const set = (next: GhState) => writeFile(file, JSON.stringify(next));
  await set(state);
  return { set, uninstall() { process.env.PATH = empty; } };
}
