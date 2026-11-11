const { chmod, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

/**
 * Writes the executables of the `gh` CLI double into `bin`: `gh`, which runs tests/fixtures/gh-cli.cjs answering
 * from `stateFile`, and `login-shell`, which reports this process's environment as the user's login shell would.
 * The unit and desktop suites both put them on the product's PATH and SHELL.
 */
async function writeGhDoubleScripts(bin, stateFile) {
  const node = process.env.VIBEBRIDGE_TEST_NODE;
  const fixture = JSON.stringify(resolve('tests/fixtures/gh-cli.cjs'));
  const gh = join(bin, 'gh');
  const shell = join(bin, 'login-shell');
  // Extensionless scripts in this package load as ES modules, so the fixture is required explicitly.
  await writeFile(gh, `#!${node}\nprocess.getBuiltinModule('node:module').createRequire(${fixture})(${fixture})(${JSON.stringify(stateFile)}, process.argv.slice(2));\n`);
  await writeFile(shell, `#!${node}\nprocess.stdout.write('\\0VIBEBRIDGE_ENV\\0' + Object.entries(process.env).map(([key, value]) => key + '=' + value + '\\0').join(''));\n`);
  await chmod(gh, 0o755); await chmod(shell, 0o755);
  return { gh, shell };
}

module.exports = { writeGhDoubleScripts };
