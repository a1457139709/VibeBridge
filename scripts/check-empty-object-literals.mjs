import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const failures = [];

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(file);
    } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/.test(entry.name)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (
          ts.isVariableDeclaration(node) &&
          !node.type &&
          node.initializer &&
          ts.isObjectLiteralExpression(node.initializer) &&
          node.initializer.properties.length === 0
        ) {
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
  for (const directory of ['app', 'tests', 'scripts']) await checkDirectory(directory);
  if (failures.length) {
    console.error(`A variable initialized to {} must declare its type:\n${failures.join('\n')}
Annotate the type the object will hold. A token that only compares identity uses LatestRequest's RequestTicket or a type of its own.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Empty object literal check failed: ${error.message}`);
  process.exitCode = 1;
}
