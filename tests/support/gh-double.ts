import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';

export interface GhState {
  login?: string;
  repositories?: string[];
  pageSize?: number;
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
