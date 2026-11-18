import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

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

async function checkWorkbench() {
  const source = ts.createSourceFile(workbench, await readFile(workbench, 'utf8'), ts.ScriptTarget.Latest, true);
  for (const { node, target } of forwarders(source)) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push(`${workbench}:${line + 1}: ${node.name.getText(source)} only forwards to ${target}`);
  }
}

try {
  await checkWorkbench();
  if (failures.length) {
    console.error(`Source shape check failed:\n${failures.join('\n')}

Forwarding methods: callers call the feature module directly, as IPC calls workbench.runs;
Workbench keeps the methods that queue an operation or combine feature modules.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Source shape check failed: ${error.message}`);
  process.exitCode = 1;
}
