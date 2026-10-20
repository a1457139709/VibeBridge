import { execFileSync } from 'node:child_process';

const maxBytes = 5000 * 4;

function checkStagedFiles() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trimEnd();
  const git = (args, input) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', input, maxBuffer: 16 * 1024 * 1024,
  });
  // Disabling rename detection also checks the destination of renames and copies.
  const changes = git(['diff', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=ACMT'])
    .split('\0');
  const files = [];
  for (let i = 0; i < changes.length - 1; i += 2) {
    const [, mode, , object] = changes[i].split(' ');
    // Symlinks and submodules do not contain authored file contents.
    if (mode === '100644' || mode === '100755') files.push({ path: changes[i + 1], object });
  }
  if (!files.length) return;

  // Use staged attributes too: unstaged exclusions must not change the result.
  const attributes = git(['check-attr', '--cached', '-z', '--stdin', 'linguist-generated', 'linguist-vendored'],
    files.map(file => file.path).join('\0') + '\0').split('\0');
  const ignored = new Set();
  for (let i = 0; i < attributes.length - 1; i += 3) {
    if (attributes[i + 2] === 'set' || attributes[i + 2] === 'true') ignored.add(attributes[i]);
  }
  const authoredFiles = files.filter(file => !ignored.has(file.path));
  if (!authoredFiles.length) return;

  // Read blob sizes from the index's object IDs, never from working-tree files.
  const sizes = git(['cat-file', '--batch-check=%(objectsize)'],
    authoredFiles.map(file => file.object).join('\n') + '\n').trimEnd().split('\n');
  const oversized = [];
  authoredFiles.forEach((file, index) => {
    const bytes = Number(sizes[index]);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`Cannot read staged size of ${JSON.stringify(file.path)}`);
    if (bytes > maxBytes) oversized.push(`  ${JSON.stringify(file.path)}: ${bytes / 4} tokens (${bytes} bytes)`);
  });
  if (!oversized.length) return;

  console.error(`Commit blocked: staged files exceed 5,000 tokens (20,000 bytes; tokens = bytes / 4).
${oversized.join('\n')}

Split each file before committing:
1. Group related responsibilities and move each group into a focused, clearly named file.
   Code: extract cohesive modules/components and update imports/exports and callers.
   Tests: split by feature or scenario; move shared setup into a small helper.
   Docs/data: split by topic or logical section and update links or loaders.
2. Keep every resulting file at or below 20,000 bytes. Preserve behavior; do not minify
   code or delete useful comments just to meet the limit.
3. Run the relevant checks, then git add the original and new files and retry the commit.

Only tool-produced or vendored files should be excluded: mark their exact paths with
linguist-generated or linguist-vendored in .gitattributes and stage that file too.`);
  process.exitCode = 1;
}

try {
  checkStagedFiles();
} catch (error) {
  console.error(`Staged file-size check failed: ${error.message}`);
  process.exitCode = 1;
}
