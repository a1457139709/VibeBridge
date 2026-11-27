import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const allowed = new Map([
  [
    'app/main/electron.ts',
    "Without the login shell's PATH the Forge CLI is looked up on the inherited PATH, and a CLI missing there is reported as not installed.",
  ],
  [
    'app/main/agent-status/reporter.ts',
    "A hook reporter always exits successfully, so a report it cannot send never fails the Agent's hook.",
  ],
  [
    'tests/desktop/terminal-punctuation.test.cjs',
    'Clearing the IME composition is teardown after the assertion; a window already closing must not hide its result.',
  ],
]);
const failures = [];

const emptyCallback = node =>
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
  ts.isBlock(node.body) &&
  node.body.statements.length === 0;

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      await checkDirectory(file);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) && !allowed.has(file)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'catch' &&
          node.arguments.length > 0 &&
          emptyCallback(node.arguments[0])
        ) {
          const { line, character } = source.getLineAndCharacterOfPosition(node.expression.name.getStart(source));
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
    console.error(`A .catch callback must not be empty:\n${failures.join('\n')}
Rethrow the error, report it to the user, or fall back as a spec, ADR or issue resolution designs it.
Best-effort cleanup after a failure uses cleanUpAfterFailure.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Empty catch callback check failed: ${error.message}`);
  process.exitCode = 1;
}
