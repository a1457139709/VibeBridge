import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const issuePath = /(?:^|[\\/])issue[-_]\d+(?=$|[\\/._-])/i;
const failures = [];

async function checkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(file);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
      if (issuePath.test(file)) failures.push(`${file}: name files by their responsibility.`);
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        const parts = ts.isTemplateExpression(node) ? [node.head, ...node.templateSpans.map(span => span.literal)]
          : ts.isStringLiteralLike(node) ? [node] : [];
        if (parts.length && !/^[a-z][a-z\d+.-]*:\/\//i.test(parts[0].text)) {
          for (const part of parts) {
            if (!issuePath.test(part.text)) continue;
            const { line, character } = source.getLineAndCharacterOfPosition(part.getStart(source));
            failures.push(`${file}:${line + 1}:${character + 1}: ${JSON.stringify(part.text)}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}

try {
  for (const directory of ['app', 'tests', 'scripts']) await checkDirectory(directory);
  if (failures.length) {
    console.error(`Issue-numbered local paths are not allowed in source files:\n${failures.join('\n')}\nUse feature or scenario names; keep issue references in links or comments.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Source path check failed: ${error.message}`);
  process.exitCode = 1;
}
