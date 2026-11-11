import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';

/** An issue of every repository the double lists, as GitHub's API names its fields. */
export interface GhIssue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  stateReason: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | null;
  createdAt: string;
  labels: string[];
  /** The number of the issue this one is a sub-issue of. */
  parent?: number;
  /** Numbers of the issues natively marked as blocking this one. */
  blockedBy?: number[];
}

/** A pull request of every repository the double lists, as GitHub's API names its fields.
 * `checks` is the head commit's check rollup state, null when nothing reports on it. */
export interface GhPullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  /** Null for a deleted account. */
  author: string | null;
  createdAt: string;
  labels: string[];
  checks: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null;
}

export interface GhState {
  login?: string;
  /** Repositories the account may bind; any other repository is not found. */
  repositories?: string[];
  pageSize?: number;
  issues?: GhIssue[];
  /** Numbers are shared with issues, as on GitHub, so keep them apart. */
  pullRequests?: GhPullRequest[];
  labels?: { name: string; color: string }[];
  failure?: { exit: number; stdout?: string; stderr?: string };
}

/**
 * Puts a `gh` CLI double (tests/fixtures/gh-cli.cjs) first on PATH for this test process.
 * The Workbench finds commands through the user's login shell, so SHELL is replaced by a
 * double that reports this process's environment; PATH then holds only the double's
 * directory and the system directories, keeping any real `gh` out of reach.
 */
export async function ghDouble(context: TestContext, state: GhState) {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(resolve('work', 'gh-double-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const stateFile = join(directory, 'state.json');
  const node = process.env.VIBEBRIDGE_TEST_NODE!;
  const gh = join(bin, 'gh');
  const shell = join(directory, 'login-shell');
  const fixture = JSON.stringify(resolve('tests/fixtures/gh-cli.cjs'));
  // Extensionless scripts in this package load as ES modules, so the fixture is required explicitly.
  await writeFile(gh, `#!${node}\nprocess.getBuiltinModule('node:module').createRequire(${fixture})(${fixture})(${JSON.stringify(stateFile)}, process.argv.slice(2));\n`);
  await writeFile(shell, `#!${node}\nprocess.stdout.write('\\0VIBEBRIDGE_ENV\\0' + Object.entries(process.env).map(([key, value]) => key + '=' + value + '\\0').join(''));\n`);
  await chmod(gh, 0o755); await chmod(shell, 0o755);
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.SHELL = shell;
  context.after(async () => {
    process.env.PATH = saved.PATH; process.env.SHELL = saved.SHELL;
    await rm(directory, { recursive: true, force: true });
  });
  const write = (next: GhState) => writeFile(stateFile, JSON.stringify(next));
  await write(state);
  return {
    /** Replaces what the double answers from the next call on. */
    set: write,
    /** Takes `gh` off PATH, as when it is not installed. */
    uninstall: () => rm(gh),
  };
}
