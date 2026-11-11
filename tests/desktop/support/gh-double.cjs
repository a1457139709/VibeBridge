const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { writeGhDoubleScripts } = require('../../support/gh-double-scripts.cjs');

// Puts the `gh` CLI double first on the product's PATH, answering from `state`. The Workbench reads commands
// from the user's login shell, so SHELL becomes a double that reports this process's environment.
// Call it before anything reads a platform, in the suite's data directory.
module.exports = async (directory, state) => {
  const bin = join(directory, 'gh-double');
  await mkdir(bin, { recursive: true });
  const stateFile = join(bin, 'state.json');
  const { shell } = await writeGhDoubleScripts(bin, stateFile);
  await writeFile(stateFile, JSON.stringify(state));
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.SHELL = shell;
};
