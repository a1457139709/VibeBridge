/** Writes the `gh` CLI double and the login shell double into `bin`; see gh-double-scripts.cjs. */
export function writeGhDoubleScripts(bin: string, stateFile: string): Promise<{ gh: string; shell: string }>;
