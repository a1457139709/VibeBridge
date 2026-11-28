import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const failures = [];

const unwrapped = node => (ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node);
const isEmptyObject = node => ts.isObjectLiteralExpression(unwrapped(node)) && unwrapped(node).properties.length === 0;
const isConditionalProperty = expression =>
  (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) ||
  (ts.isConditionalExpression(expression) &&
    (isEmptyObject(expression.whenTrue) || isEmptyObject(expression.whenFalse)));
const isConditionalSpread = node =>
  (ts.isSpreadAssignment(node) || ts.isJsxSpreadAttribute(node)) && isConditionalProperty(unwrapped(node.expression));

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(file);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (isConditionalSpread(node)) {
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
    console.error(`A property is written as a plain property, not spread from \`a && { … }\` or \`c ? { … } : {}\`:\n${failures.join('\n')}
Declare the property \`T | undefined\` (\`name?: T | undefined\` when some objects leave it out) and write \`{ name }\`.
Where a receiver needs the key left out, the code that serializes for it drops \`undefined\` values.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Conditional spread check failed: ${error.message}`);
  process.exitCode = 1;
}
