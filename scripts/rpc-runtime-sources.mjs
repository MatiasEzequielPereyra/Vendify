import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export const RPC_RUNTIME_SOURCE_PATTERN = "app.js + src/**/*.ts";

function collectTypeScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTypeScriptFiles(path);
      return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
    })
    .sort();
}

export function findRuntimeRpcNames(rootDirectory) {
  const root = resolve(rootDirectory);
  const sourcePaths = [resolve(root, "app.js"), ...collectTypeScriptFiles(resolve(root, "src"))];
  const program = ts.createProgram(sourcePaths, { allowJs: true, noResolve: true, noLib: true });
  const checker = program.getTypeChecker();
  const sources = sourcePaths.map((path) => program.getSourceFile(path));
  const forwardedParameters = new Map();
  const names = [];
  const isRpcCall = (node) => ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "rpc";
  function visit(node, callback) {
    callback(node);
    ts.forEachChild(node, (child) => visit(child, callback));
  }

  // Follow the actual parameter symbol, not a helper name or arbitrary string.
  // This covers the local call/callRecord wrappers without changing the contract.
  for (const source of sources) {
    visit(source, (node) => {
      if (!isRpcCall(node)) return;
      const argument = node.arguments[0];
      if (!argument || !ts.isIdentifier(argument)) return;
      const symbol = checker.getSymbolAtLocation(argument);
      const parameter = symbol?.valueDeclaration;
      if (!parameter || !ts.isParameter(parameter)) return;
      const declaration = parameter.parent;
      if (!ts.isFunctionDeclaration(declaration)) return;
      const indexes = forwardedParameters.get(declaration) ?? new Set();
      indexes.add(declaration.parameters.indexOf(parameter));
      forwardedParameters.set(declaration, indexes);
    });
  }
  for (const source of sources) {
    visit(source, (node) => {
      if (!ts.isCallExpression(node)) return;
      const indexes = isRpcCall(node)
        ? [0]
        : forwardedParameters.get(checker.getResolvedSignature(node)?.declaration) ?? [];
      for (const index of indexes) {
        const argument = node.arguments[index];
        if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
          names.push(argument.text);
        }
      }
    });
  }

  return [...new Set(names)].sort();
}

export function listRuntimeRpcSources(rootDirectory) {
  const root = resolve(rootDirectory);
  return [resolve(root, "app.js"), ...collectTypeScriptFiles(resolve(root, "src"))]
    .map((sourcePath) => relative(root, sourcePath).replaceAll("\\", "/"));
}
