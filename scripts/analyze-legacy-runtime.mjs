import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const appPath = resolve(root, "app.js");
const cssPath = resolve(root, "styles.css");
const htmlPath = resolve(root, "index.html");

const appSource = readFileSync(appPath, "utf8");
const cssSource = readFileSync(cssPath, "utf8");
const htmlSource = readFileSync(htmlPath, "utf8");
const sourceFile = ts.createSourceFile(
  "app.js",
  appSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.JS
);

function lineOf(node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function collectBindingNames(name, target) {
  if (ts.isIdentifier(name)) {
    target.add(name.text);
    return;
  }
  for (const element of name.elements ?? []) {
    if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, target);
  }
}

function collectTopLevel() {
  const functions = new Map();
  const globals = new Set();

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, {
        name: statement.name.text,
        node: statement,
        line: lineOf(statement),
        async: statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingNames(declaration.name, globals);
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
        ) {
          functions.set(declaration.name.text, {
            name: declaration.name.text,
            node: declaration.initializer,
            line: lineOf(declaration),
            async: declaration.initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) === true
          });
        }
      }
    }
  }

  return { functions, globals };
}

const { functions, globals } = collectTopLevel();
const functionNames = new Set(functions.keys());

function classify(name) {
  const value = name.toLowerCase();
  const groups = [
    ["offline", /(offline|sync|conexion|connection|cache|indexeddb|cola)/],
    ["auth", /(auth|login|logout|sesion|session|password|empleado|employee|registro|register)/],
    ["app-context", /(contexto|context|negocio|business|sucursal|branch|permiso|permission|navigation|naveg|selector)/],
    ["products", /(producto|product|categoria|category|barcode|codigo|scanner|foto|imagen|crop)/],
    ["inventory", /(stock|inventario|inventory|reposicion|ajuste|transfer|conteo)/],
    ["cash", /(caja|cash|arqueo|apertura|cierre|movimiento.*caja)/],
    ["purchases", /(compra|purchase|proveedor|supplier)/],
    ["dashboard", /(dashboard|reporte|report|kpi|estadistica|metric|grafico|chart)/],
    ["team", /(equipo|team|miembro|member|rol|role|usuario.*interno)/],
    ["sales-pos", /(venta|sale|carrito|cart|checkout|cobrar|pago|payment|descuento|discount|ticket|devolucion|return)/],
    ["realtime", /(realtime|suscribir|subscribe|channel)/],
    ["ui-core", /(modal|toast|confirm|escapehtml|icon|theme|tema|render|mostrar|ocultar|abrir|cerrar)/]
  ];

  for (const [group, pattern] of groups) {
    if (pattern.test(value)) return group;
  }
  return "misc";
}

function collectLocalNames(fnNode) {
  const local = new Set();
  for (const parameter of fnNode.parameters ?? []) collectBindingNames(parameter.name, local);

  function visit(node) {
    if (ts.isVariableDeclaration(node)) collectBindingNames(node.name, local);
    if (ts.isFunctionDeclaration(node) && node !== fnNode && node.name) local.add(node.name.text);
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(fnNode, visit);
  return local;
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

function inspectFunction(meta) {
  const calls = new Set();
  const globalRefs = new Set();
  const rpcs = new Set();
  const domSelectors = new Set();
  const events = new Set();
  const localNames = collectLocalNames(meta.node);

  function visit(node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (globals.has(name) && !localNames.has(name)) globalRefs.add(name);
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;

      if (ts.isIdentifier(expression) && functionNames.has(expression.text)) {
        calls.add(expression.text);
      }

      if (ts.isPropertyAccessExpression(expression) && expression.name.text === "rpc") {
        const rpc = node.arguments[0] ? literalText(node.arguments[0]) : null;
        if (rpc) rpcs.add(rpc);
      }

      if (ts.isIdentifier(expression) && (expression.text === "$" || expression.text === "$$")) {
        const selector = node.arguments[0] ? literalText(node.arguments[0]) : null;
        if (selector) domSelectors.add(selector);
      }

      if (ts.isPropertyAccessExpression(expression)) {
        const method = expression.name.text;
        if (["querySelector", "querySelectorAll", "getElementById"].includes(method)) {
          const selector = node.arguments[0] ? literalText(node.arguments[0]) : null;
          if (selector) domSelectors.add(method === "getElementById" ? `#${selector}` : selector);
        }
        if (method === "addEventListener") {
          const eventName = node.arguments[0] ? literalText(node.arguments[0]) : null;
          if (eventName) events.add(eventName);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(meta.node, visit);

  return {
    name: meta.name,
    line: meta.line,
    async: meta.async,
    group: classify(meta.name),
    calls: [...calls].filter((name) => name !== meta.name).sort(),
    globals: [...globalRefs].sort(),
    rpcs: [...rpcs].sort(),
    domSelectors: [...domSelectors].sort(),
    events: [...events].sort()
  };
}

const functionDetails = [...functions.values()].map(inspectFunction);
const inbound = new Map(functionDetails.map((fn) => [fn.name, 0]));
for (const fn of functionDetails) {
  for (const callee of fn.calls) inbound.set(callee, (inbound.get(callee) ?? 0) + 1);
}

const groups = new Map();
for (const fn of functionDetails) {
  const bucket = groups.get(fn.group) ?? {
    functions: [],
    globals: new Set(),
    rpcs: new Set(),
    domSelectors: new Set(),
    events: new Set(),
    outgoingCalls: 0,
    inboundCalls: 0
  };
  bucket.functions.push(fn.name);
  fn.globals.forEach((value) => bucket.globals.add(value));
  fn.rpcs.forEach((value) => bucket.rpcs.add(value));
  fn.domSelectors.forEach((value) => bucket.domSelectors.add(value));
  fn.events.forEach((value) => bucket.events.add(value));
  bucket.outgoingCalls += fn.calls.length;
  bucket.inboundCalls += inbound.get(fn.name) ?? 0;
  groups.set(fn.group, bucket);
}

const globalUsage = new Map();
for (const fn of functionDetails) {
  for (const name of fn.globals) globalUsage.set(name, (globalUsage.get(name) ?? 0) + 1);
}

const rpcNames = [...new Set(functionDetails.flatMap((fn) => fn.rpcs))].sort();
const domSelectors = [...new Set(functionDetails.flatMap((fn) => fn.domSelectors))].sort();
const eventNames = [...new Set(functionDetails.flatMap((fn) => fn.events))].sort();

const highCoupling = [...functionDetails]
  .map((fn) => ({
    name: fn.name,
    line: fn.line,
    group: fn.group,
    outbound: fn.calls.length,
    inbound: inbound.get(fn.name) ?? 0,
    globals: fn.globals.length,
    score: fn.calls.length + (inbound.get(fn.name) ?? 0) + fn.globals.length
  }))
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  .slice(0, 20);

const cssSections = [...cssSource.matchAll(/\/\*\s*=+\s*([^*\n]+?)\s*=+\s*\*\//g)]
  .map((match) => match[1].trim());
const cssRuleApprox = (cssSource.match(/\{/g) ?? []).length;
const cssVariables = [...new Set([...cssSource.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((match) => match[1]))];
const htmlIds = [...new Set([...htmlSource.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]))];
const scriptRefs = [...htmlSource.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1]);

const groupRows = [...groups.entries()]
  .map(([name, value]) => ({
    name,
    functions: value.functions.length,
    globals: value.globals.size,
    rpcs: value.rpcs.size,
    dom: value.domSelectors.size,
    events: value.events.size,
    coupling: value.outgoingCalls + value.inboundCalls
  }))
  .sort((a, b) => b.functions - a.functions || a.name.localeCompare(b.name));

const extractionCandidates = [...groupRows]
  .filter((group) => !["sales-pos", "offline", "misc"].includes(group.name))
  .map((group) => ({
    ...group,
    couplingPerFunction: group.functions > 0 ? Number((group.coupling / group.functions).toFixed(2)) : 0
  }))
  .sort((a, b) => a.couplingPerFunction - b.couplingPerFunction || a.functions - b.functions);

console.log("\n=== Vendify legacy architecture map ===");
console.log(`app.js: ${appSource.split(/\r?\n/).length.toLocaleString("en-US")} lines · ${Buffer.byteLength(appSource).toLocaleString("en-US")} bytes`);
console.log(`styles.css: ${cssSource.split(/\r?\n/).length.toLocaleString("en-US")} lines · ${Buffer.byteLength(cssSource).toLocaleString("en-US")} bytes · ~${cssRuleApprox} blocks`);
console.log(`index.html: ${htmlSource.split(/\r?\n/).length.toLocaleString("en-US")} lines · ${htmlIds.length} ids · ${scriptRefs.length} external scripts`);
console.log(`top-level functions: ${functionDetails.length}`);
console.log(`top-level state/global bindings: ${globals.size}`);
console.log(`RPCs referenced inside top-level functions: ${rpcNames.length}`);
console.log(`DOM selectors referenced inside top-level functions: ${domSelectors.length}`);
console.log(`event names referenced inside top-level functions: ${eventNames.length}`);

console.log("\n--- Functional groups (heuristic) ---");
console.table(groupRows);

console.log("\n--- Highest coupling functions ---");
console.table(highCoupling);

console.log("\n--- Most shared top-level state ---");
console.table(
  [...globalUsage.entries()]
    .map(([name, usedByFunctions]) => ({ name, usedByFunctions }))
    .sort((a, b) => b.usedByFunctions - a.usedByFunctions || a.name.localeCompare(b.name))
    .slice(0, 20)
);

console.log("\n--- RPC contract names ---");
console.log(rpcNames.join("\n"));

console.log("\n--- CSS sections detected ---");
console.log(cssSections.length > 0 ? cssSections.join("\n") : "(no section headers detected)");
console.log(`CSS custom properties: ${cssVariables.length}`);

console.log("\n--- Suggested low-risk extraction candidates (heuristic only) ---");
console.table(extractionCandidates.slice(0, 8));

console.log("\nNOTE: this map is intentionally heuristic. It is a migration aid, not proof that a module is isolated. Browser regression tests remain mandatory after every extraction.\n");
