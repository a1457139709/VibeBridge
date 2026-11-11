const { chmod, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

// Puts the `gh` CLI double (tests/fixtures/gh-cli.cjs) first on the product's PATH, answering from `state`.
// The Workbench reads commands from the user's login shell, so SHELL becomes a double that reports this
// process's environment. Call it before anything reads a platform, in the suite's data directory.
module.exports = async (directory, state) => {
  const bin = join(directory, 'gh-double');
  await mkdir(bin, { recursive: true });
  const stateFile = join(bin, 'state.json');
  const node = process.env.VIBEBRIDGE_TEST_NODE;
  const fixture = JSON.stringify(resolve('tests/fixtures/gh-cli.cjs'));
  const gh = join(bin, 'gh');
  const shell = join(bin, 'login-shell');
  await writeFile(gh, `#!${node}\nprocess.getBuiltinModule('node:module').createRequire(${fixture})(${fixture})(${JSON.stringify(stateFile)}, process.argv.slice(2));\n`);
  await writeFile(shell, `#!${node}\nprocess.stdout.write('\\0VIBEBRIDGE_ENV\\0' + Object.entries(process.env).map(([key, value]) => key + '=' + value + '\\0').join(''));\n`);
  await chmod(gh, 0o755); await chmod(shell, 0o755);
  await writeFile(stateFile, JSON.stringify(state));
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.SHELL = shell;
};
