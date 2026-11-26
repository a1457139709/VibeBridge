import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { holdToBaseline } from './ratchet.mjs';

const roots = ['app', 'scripts', 'tests'];
const skipped = new Set(['node_modules', 'dist']);
const source = /\.(?:[cm]?[jt]s|[jt]sx|css)$/;
const directive = /^\/[/*]\s*(?:@ts-expect-error|prettier-ignore)\b/;
const baselineFile = join('scripts', 'comment-baseline.json');

async function listSources(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = directory === '.' ? entry.name : join(directory, entry.name);
    if (entry.isDirectory()) {
      if (directory !== '.' && !skipped.has(entry.name)) files.push(...(await listSources(path)));
    } else if (entry.isFile() && source.test(entry.name)) files.push(path);
  }
  return files;
}

function scriptCommentLines(file, text) {
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const starts = new Set();
  const collect = ranges => {
    for (const range of ranges ?? []) starts.add(range.pos);
  };
  const visit = node => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    for (const child of node.getChildren(tree)) visit(child);
  };
  visit(tree);
  return [...starts]
    .filter(start => !text.startsWith('#!', start) && !directive.test(text.slice(start)))
    .map(start => tree.getLineAndCharacterOfPosition(start).line + 1);
}

function styleCommentLines(text) {
  const lines = [];
  let line = 1;
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\n') line++;
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (text.startsWith('/*', index)) {
      if (!directive.test(text.slice(index))) lines.push(line);
      const end = text.indexOf('*/', index + 2);
      const stop = end < 0 ? text.length : end + 2;
      for (let skip = index; skip < stop; skip++) if (text[skip] === '\n') line++;
      index = stop - 1;
    }
  }
  return lines;
}

async function findComments() {
  const found = new Map();
  const files = [...(await listSources('.')), ...(await Promise.all(roots.map(listSources))).flat()];
  for (const file of files.sort()) {
    const text = await readFile(file, 'utf8');
    const lines = file.endsWith('.css') ? styleCommentLines(text) : scriptCommentLines(file, text);
    if (lines.length) found.set(file.split('\\').join('/'), lines);
  }
  return found;
}

try {
  await holdToBaseline({
    baselineFile,
    found: await findComments(),
    counted: 'comments',
    updateCommand: 'check:comments',
    explanation: added => `Source code carries no comments (docs/adr/0010-code-carries-no-comments.md):\n${added}

Delete a comment that repeats the code or describes code that is gone. For one that excuses a shortcut, file an issue
to fix the shortcut. Move a decision the code cannot show into docs/adr/ or docs/. Run /delete-comment for the process.`,
  });
} catch (error) {
  console.error(`Comment check failed: ${error.message}`);
  process.exitCode = 1;
}
