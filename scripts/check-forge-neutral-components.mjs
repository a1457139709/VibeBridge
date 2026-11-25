import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const githubText = /github|\bgh auth\b/i;
const failures = [];

async function checkForgeNeutralComponents(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkForgeNeutralComponents(file);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        const parts = ts.isTemplateExpression(node)
          ? [node.head, ...node.templateSpans.map(span => span.literal)]
          : ts.isStringLiteralLike(node) || ts.isJsxText(node)
            ? [node]
            : [];
        const githubName = ts.isIdentifier(node) && /github/i.test(node.text);
        if (githubName || parts.some(part => githubText.test(part.text))) {
          const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${file}:${line + 1}:${character + 1}: ${node.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}

try {
  await checkForgeNeutralComponents(join('tests', 'components'));
  if (failures.length) {
    console.error(`Component tests must not use GitHub values:\n${failures.join('\n')}
Use the test Forge from tests/components/support/forge.ts.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Forge-neutral components check failed: ${error.message}`);
  process.exitCode = 1;
}
