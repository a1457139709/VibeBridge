import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const fixedWait = /new Promise\(\s*\(?\s*[A-Za-z_$][\w$]*\s*\)?\s*=>\s*\{?\s*(?:setTimeout|requestAnimationFrame)\(/;
const failures = [];
const insideUntil = node => {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope)) continue;
    const name =
      scope.name ??
      (ts.isVariableDeclaration(scope.parent) || ts.isPropertyAssignment(scope.parent) ? scope.parent.name : undefined);
    if (name && ts.isIdentifier(name) && name.text === 'until') return true;
  }
  return false;
};

async function checkTestWaits(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (file !== join('tests', 'fixtures')) await checkTestWaits(file);
    } else if (entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) {
      const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const visit = node => {
        const candidate = ts.isNewExpression(node) || ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
        if (candidate && !insideUntil(node) && fixedWait.test(node.getText(source))) {
          const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${file}:${line + 1}:${character + 1}`);
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
}

try {
  await checkTestWaits('tests');
  if (failures.length) {
    console.error(`Tests must not wait a fixed time or a fixed number of frames:\n${failures.join('\n')}
Wait with until() for the state the behaviour settles in, or prove that something does not happen in a unit test.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Test wait check failed: ${error.message}`);
  process.exitCode = 1;
}
