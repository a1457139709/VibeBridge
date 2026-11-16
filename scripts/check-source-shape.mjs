import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

// A line past this width packs several statements or declarations together; wrap it as the surrounding code wraps.
const maxLine = 200;
// A line holding one string longer than the limit, such as an SVG path, is data rather than packed code.
const dataString = new RegExp(`"[^"]{${maxLine},}"|'[^']{${maxLine},}'`);
// Workbench coordinates work across feature modules (docs/adr/0007-workbench-only-coordinates.md).
const workbench = join('app', 'main', 'workbench.ts');
const failures = [];

/** A call of a method on one of the instance's fields: `this.field.method(...)`. */
const fieldCall = node => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
  && ts.isPropertyAccessExpression(node.expression.expression)
  && node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword;

/** A method whose body is one call on a field, as a return or a statement, forwards a call it adds nothing to. */
function forwarders(source) {
  const found = [];
  const visit = node => {
    if (ts.isMethodDeclaration(node) && node.body?.statements.length === 1) {
      const [statement] = node.body.statements;
      const expression = ts.isReturnStatement(statement) || ts.isExpressionStatement(statement) ? statement.expression : undefined;
      let call = expression;
      while (call && ts.isAwaitExpression(call)) call = call.expression;
      if (call && fieldCall(call)) found.push({ node, target: call.expression.getText(source) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

async function checkDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) { await checkDirectory(file); continue; }
    if (!entry.isFile() || !/\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name)) continue;
    const text = await readFile(file, 'utf8');
    text.split('\n').forEach((line, index) => {
      if (line.length > maxLine && !dataString.test(line)) failures.push(`${file}:${index + 1}: ${line.length} characters (at most ${maxLine})`);
    });
    if (file !== workbench) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const { node, target } of forwarders(source)) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${file}:${line + 1}: ${node.name.getText(source)} only forwards to ${target}`);
    }
  }
}

try {
  for (const directory of ['app', 'tests', 'scripts']) if (existsSync(directory)) await checkDirectory(directory);
  if (failures.length) {
    console.error(`Source shape check failed:\n${failures.join('\n')}

Long lines: wrap them as the surrounding code wraps, one statement or declaration per line.
Forwarding methods: callers call the feature module directly, as IPC calls workbench.runs;
Workbench keeps the methods that queue an operation or combine feature modules.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Source shape check failed: ${error.message}`);
  process.exitCode = 1;
}
