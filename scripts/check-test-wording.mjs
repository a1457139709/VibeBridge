import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

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

function hardCoded(node) {
  if (!node) return false;
  if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node)) return true;
  if (ts.isParenthesizedExpression(node)) return hardCoded(node.expression);
  if (ts.isConditionalExpression(node)) return hardCoded(node.whenTrue) || hardCoded(node.whenFalse);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return hardCoded(node.left) || hardCoded(node.right);
  if (ts.isTemplateExpression(node))
    return (
      node.head.text !== '' || node.templateSpans.some(span => span.literal.text !== '' || hardCoded(span.expression))
    );
  return false;
}

function hardCodedName(options) {
  if (!options || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    property =>
      ts.isPropertyAssignment(property) &&
      ts.isIdentifier(property.name) &&
      property.name.text === 'name' &&
      hardCoded(property.initializer),
  );
}

function wordingQuery(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
  if (!ts.isIdentifier(callee)) return false;
  const [first, options] = node.arguments;
  if (textQuery.test(callee.text)) return true;
  if (labelQuery.test(callee.text)) return hardCoded(first);
  if (roleQuery.test(callee.text)) return hardCodedName(options);
  return false;
}

function wordingLines(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = [];
  const visit = node => {
    if (wordingQuery(node)) lines.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return lines;
}

async function findWordingQueries() {
  const found = new Map();
  for (const file of (await listTests('tests')).sort()) {
    const lines = wordingLines(file, await readFile(file, 'utf8'));
    if (lines.length) found.set(file.split('\\').join('/'), lines);
  }
  return found;
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(baselineFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

try {
  const found = await findWordingQueries();
  let allowance = await readBaseline();
  if (process.argv.includes('--update')) {
    const lowered = {};
    for (const [file, allowed] of Object.entries(allowance)) {
      const count = Math.min(found.get(file)?.length ?? 0, allowed);
      if (count) lowered[file] = count;
    }
    await writeFile(baselineFile, `${JSON.stringify(lowered, null, 2)}\n`);
    allowance = lowered;
  }
  const added = [];
  const shrunk = [];
  for (const [file, lines] of found) {
    if (lines.length > (allowance[file] ?? 0))
      added.push(
        `${file}: ${lines.length} wording queries, ${allowance[file] ?? 0} allowed (lines ${lines.join(', ')})`,
      );
  }
  for (const [file, allowed] of Object.entries(allowance)) {
    const count = found.get(file)?.length ?? 0;
    if (count < allowed) shrunk.push(`${file}: ${count} wording queries, baseline ${allowed}`);
  }
  if (added.length) {
    console.error(`Tests confirm behaviour, not wording (docs/adr/0009-tests-confirm-behaviour-not-wording.md):\n${added.join('\n')}

Replace a *ByText query with a role query, and give an accessible name from the locale, { name: t(id) },
instead of a literal string or regular expression. Assert structured values where the behaviour allows it.`);
    process.exitCode = 1;
  }
  if (shrunk.length) {
    console.error(
      `Wording queries were removed below the baseline; lower it with npm run check:test-wording -- --update:\n${shrunk.join('\n')}`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Test wording check failed: ${error.message}`);
  process.exitCode = 1;
}
