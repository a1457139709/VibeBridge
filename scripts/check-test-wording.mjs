import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { holdToBaseline } from './ratchet.mjs';

const baselineFile = join('scripts', 'test-wording-baseline.json');
const textQuery = /^(?:get|query|find)(?:All)?ByText$/;
const labelQuery = /^(?:get|query|find)(?:All)?By(?:LabelText|PlaceholderText|AltText|Title|DisplayValue)$/;
const roleQuery = /^(?:get|query|find)(?:All)?ByRole$/;

async function listTests(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== join('tests', 'fixtures')) files.push(...(await listTests(path)));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

function wordingLines(checker, tree) {
  const declarationsOf = identifier => {
    const symbol =
      ts.isShorthandPropertyAssignment(identifier.parent) && identifier.parent.name === identifier
        ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
        : checker.getSymbolAtLocation(identifier);
    return (symbol?.declarations ?? []).filter(declaration => declaration.getSourceFile() === tree);
  };

  const returnsFixedText = (fn, seen) => {
    if (!fn.body) return false;
    if (!ts.isBlock(fn.body)) return fixedText(fn.body, seen);
    let found = false;
    const visit = node => {
      if (found || ts.isFunctionLike(node)) return;
      if (ts.isReturnStatement(node) && fixedText(node.expression, seen)) found = true;
      else ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
    return found;
  };

  const boundTo = (identifier, seen, read) =>
    declarationsOf(identifier).some(declaration => {
      if (seen.has(declaration)) return false;
      const next = new Set(seen).add(declaration);
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) return read(declaration.initializer, next);
      if (ts.isFunctionDeclaration(declaration)) return read(declaration, next);
      return false;
    });

  const callReturnsFixedText = (call, seen) =>
    ts.isIdentifier(call.expression) &&
    boundTo(call.expression, seen, (bound, next) => {
      const fn = ts.isParenthesizedExpression(bound) ? bound.expression : bound;
      return (
        (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) &&
        returnsFixedText(fn, next)
      );
    });

  function fixedText(node, seen = new Set()) {
    if (!node) return false;
    if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node)) return true;
    if (ts.isParenthesizedExpression(node)) return fixedText(node.expression, seen);
    if (ts.isConditionalExpression(node)) return fixedText(node.whenTrue, seen) || fixedText(node.whenFalse, seen);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return fixedText(node.left, seen) || fixedText(node.right, seen);
    if (ts.isTemplateExpression(node))
      return (
        node.head.text !== '' ||
        node.templateSpans.some(span => span.literal.text !== '' || fixedText(span.expression, seen))
      );
    if (ts.isIdentifier(node)) return boundTo(node, seen, fixedText);
    if (ts.isCallExpression(node)) return callReturnsFixedText(node, seen);
    return false;
  }

  const fixedName = options =>
    !!options &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(property => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text === 'name' && fixedText(property.name);
      return (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'name' &&
        fixedText(property.initializer)
      );
    });

  const wordingQuery = node => {
    if (!ts.isCallExpression(node)) return false;
    const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
    if (!ts.isIdentifier(callee)) return false;
    const [first, options] = node.arguments;
    if (textQuery.test(callee.text)) return true;
    if (labelQuery.test(callee.text)) return fixedText(first);
    if (roleQuery.test(callee.text)) return fixedName(options);
    return false;
  };

  const lines = [];
  const visit = node => {
    if (wordingQuery(node)) lines.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return lines;
}

async function findWordingQueries() {
  const files = (await listTests('tests')).sort();
  const program = ts.createProgram(files, { noResolve: true, noLib: true, types: [], jsx: ts.JsxEmit.Preserve });
  const checker = program.getTypeChecker();
  const found = new Map();
  for (const file of files) {
    const tree = program.getSourceFile(file);
    if (!tree) throw new Error(`${file} could not be parsed`);
    const lines = wordingLines(checker, tree);
    if (lines.length) found.set(file.split('\\').join('/'), lines);
  }
  return found;
}

try {
  await holdToBaseline({
    baselineFile,
    found: await findWordingQueries(),
    counted: 'wording queries',
    updateCommand: 'check:test-wording',
    explanation:
      added => `Tests confirm behaviour, not wording (docs/adr/0009-tests-confirm-behaviour-not-wording.md):\n${added}

Replace a *ByText query with a role query, and give an accessible name from the locale, { name: t(id) },
instead of a literal string or regular expression. Assert structured values where the behaviour allows it.`,
  });
} catch (error) {
  console.error(`Test wording check failed: ${error.message}`);
  process.exitCode = 1;
}
