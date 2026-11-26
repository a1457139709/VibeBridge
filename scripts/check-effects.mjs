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

const isReact = node => node !== undefined && ts.isStringLiteralLike(node) && node.text === 'react';

function effectLines(checker, tree) {
  const hookBindings = new Set();
  const moduleBindings = new Set();

  const boundTo = (identifier, bindings) =>
    (checker.getSymbolAtLocation(identifier)?.declarations ?? []).some(declaration => bindings.has(declaration));

  const unwrapped = node =>
    ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) ? unwrapped(node.expression) : node;

  const isReactImportCall = node =>
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && isReact(node.arguments[0]);

  const isModule = expression => {
    const node = unwrapped(expression);
    return isReactImportCall(node) || (ts.isIdentifier(node) && boundTo(node, moduleBindings));
  };

  const bindModule = declaration => {
    if (ts.isIdentifier(declaration.name)) moduleBindings.add(declaration);
    else if (ts.isObjectBindingPattern(declaration.name))
      for (const element of declaration.name.elements) {
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) && effectHooks.has(key.text)) hookBindings.add(element);
      }
  };

  const collectBindings = node => {
    if (ts.isImportDeclaration(node) && isReact(node.moduleSpecifier) && node.importClause) {
      const clause = node.importClause;
      if (clause.name) moduleBindings.add(clause);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) moduleBindings.add(bindings);
      if (bindings && ts.isNamedImports(bindings))
        for (const specifier of bindings.elements)
          if (effectHooks.has((specifier.propertyName ?? specifier.name).text)) hookBindings.add(specifier);
    }
    if (ts.isVariableDeclaration(node) && node.initializer && isModule(node.initializer)) bindModule(node);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'then' &&
      isModule(node.expression.expression)
    ) {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && callback.parameters[0])
        bindModule(callback.parameters[0]);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(tree);

  const hookMember = node => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression))
      return node.argumentExpression.text;
    return undefined;
  };

  const referencesHook = node => {
    if (ts.isIdentifier(node)) return boundTo(node, hookBindings);
    if (ts.isExportSpecifier(node))
      return isReact(node.parent.parent.moduleSpecifier) && effectHooks.has((node.propertyName ?? node.name).text);
    const member = hookMember(node);
    return member !== undefined && effectHooks.has(member) && isModule(node.expression);
  };

  const lines = [];
  const visit = node => {
    if (ts.isImportDeclaration(node) || hookBindings.has(node)) return;
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
