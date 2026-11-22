const { chmod, mkdir, writeFile } = require('node:fs/promises');
const { join, resolve } = require('node:path');

module.exports = async (directory, state) => {
  const bin = join(directory, 'gh-double');
  await mkdir(bin, { recursive: true });
  const program = join(bin, 'gh');
  await writeFile(
    program,
    `#!/bin/sh\nexec '${process.env.VIBEBRIDGE_TEST_NODE}' '${resolve('tests/fixtures/gh-cli.cjs')}' "$@"\n`,
  );
  await chmod(program, 0o755);
  const file = join(bin, 'state.json');
  await writeFile(file, JSON.stringify(state));
  process.env.VIBEBRIDGE_GH_DOUBLE = file;
  process.env.PATH = `${bin}:${process.env.PATH}`;
};
