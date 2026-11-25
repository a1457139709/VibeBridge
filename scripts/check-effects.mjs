import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';
import { holdToBaseline } from './ratchet.mjs';

const renderer = join('app', 'renderer');
const effectsDirectory = join(renderer, 'common', 'effects');
const effectHooks = new Set(['useEffect', 'useLayoutEffect']);
const baselineFile = join('scripts', 'effect-baseline.json');

async function listRendererSources(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== effectsDirectory) files.push(...(await listRendererSources(path)));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(path);
  }
  return files;
}

function effectLines(checker, tree) {
  const hookImports = new Set();
  const moduleImports = new Set();
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react' ||
      !statement.importClause
    )
      continue;
    const clause = statement.importClause;
    if (clause.name) moduleImports.add(clause);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) moduleImports.add(bindings);
    if (bindings && ts.isNamedImports(bindings))
      for (const specifier of bindings.elements)
        if (effectHooks.has((specifier.propertyName ?? specifier.name).text)) hookImports.add(specifier);
  }

  const importedAs = (identifier, imports) =>
    (checker.getSymbolAtLocation(identifier)?.declarations ?? []).some(declaration => imports.has(declaration));

  const hookMember = node => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
      return node.argumentExpression.text;
    return undefined;
  };

  const referencesHook = node => {
    if (ts.isIdentifier(node)) return importedAs(node, hookImports);
    const member = hookMember(node);
    return (
      member !== undefined &&
      effectHooks.has(member) &&
      ts.isIdentifier(node.expression) &&
      importedAs(node.expression, moduleImports)
    );
  };

  const lines = [];
  const visit = node => {
    if (ts.isImportDeclaration(node)) return;
    if (referencesHook(node)) lines.push(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1);
    else ts.forEachChild(node, visit);
  };
  visit(tree);
  return lines;
}

async function findEffects() {
  const files = (await listRendererSources(renderer)).sort();
  const program = ts.createProgram(files, { noResolve: true, noLib: true, types: [], jsx: ts.JsxEmit.Preserve });
  const checker = program.getTypeChecker();
  const found = new Map();
  for (const file of files) {
    const tree = program.getSourceFile(file);
    if (!tree) throw new Error(`${file} could not be parsed`);
    const lines = effectLines(checker, tree);
    if (lines.length) found.set(file.split('\\').join('/'), lines);
  }
  return found;
}

try {
  await holdToBaseline({
    baselineFile,
    found: await findEffects(),
    counted: 'effects',
    updateCommand: 'check:effects',
    explanation:
      added => `Effects live only in named hooks under app/renderer/common/effects (CODING_STANDARDS.md, Effects):\n${added}

Compute a value derived from props or state while rendering, and do what a user action causes in its event handler.
Synchronize with a system outside React through a named hook in app/renderer/common/effects.`,
  });
} catch (error) {
  console.error(`Effect check failed: ${error.message}`);
  process.exitCode = 1;
}
