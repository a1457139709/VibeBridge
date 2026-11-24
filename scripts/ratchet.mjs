import { readFile, writeFile } from 'node:fs/promises';

async function readBaseline(baselineFile) {
  try {
    return JSON.parse(await readFile(baselineFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function holdToBaseline({ baselineFile, found, counted, explanation, updateCommand }) {
  let allowance = await readBaseline(baselineFile);
  if (process.argv.includes('--update')) {
    const lowered = {};
    for (const [file, allowed] of Object.entries(allowance)) {
      const count = Math.min(found.get(file)?.length ?? 0, allowed);
      if (count) lowered[file] = count;
    }
    await writeFile(baselineFile, `${JSON.stringify(lowered, null, 2)}\n`);
    allowance = lowered;
  }
  const added = [];
  const shrunk = [];
  for (const [file, lines] of found) {
    if (lines.length > (allowance[file] ?? 0))
      added.push(`${file}: ${lines.length} ${counted}, ${allowance[file] ?? 0} allowed (lines ${lines.join(', ')})`);
  }
  for (const [file, allowed] of Object.entries(allowance)) {
    const count = found.get(file)?.length ?? 0;
    if (count < allowed) shrunk.push(`${file}: ${count} ${counted}, baseline ${allowed}`);
  }
  if (added.length) {
    console.error(explanation(added.join('\n')));
    process.exitCode = 1;
  }
  if (shrunk.length) {
    console.error(
      `The ${counted} fell below the baseline; lower it with npm run ${updateCommand} -- --update:\n${shrunk.join('\n')}`,
    );
    process.exitCode = 1;
  }
}
