import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`PASS: ${message}`);

if (!existsSync(resolve(root, "index.html"))) fail("refactor preview is missing index.html");

const files = readdirSync(root);
const core = files.filter((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const app = files.filter((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));
if (core.length !== 1) fail(`expected one modular core bundle, found ${core.length}`);
if (app.length !== 1) fail(`expected one refactor app bundle, found ${app.length}`);

const index = readFileSync(resolve(root, "index.html"), "utf8");
const coreMarker = `src: "${core[0]}"`;
const appMarker = `src: "${app[0]}"`;
const corePosition = index.indexOf(coreMarker);
const appPosition = index.indexOf(appMarker);
if (corePosition < 0 || appPosition < 0 || corePosition >= appPosition) {
  fail("modular core must load before the compatibility app");
}
pass("modular core loads before compatibility app");

const corePath = resolve(root, core[0]);
const appPath = resolve(root, app[0]);
const coreSource = readFileSync(corePath, "utf8");
const appSource = readFileSync(appPath, "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");
const buildSource = readFileSync(
  resolve(projectRoot, "scripts/build-refactor-modular.mjs"),
  "utf8"
);

try {
  execFileSync(process.execPath, ["--check", appPath], { stdio: "pipe" });
} catch (error) {
  const stderr = error?.stderr?.toString?.() || String(error);
  fail(`generated compatibility app has invalid JavaScript syntax: ${stderr}`);
}
pass("generated compatibility app parses without redeclarations");

for (const marker of ["VendifyCoreV232", "formatArs", "productDisplayName", "escapeHtml", "queryOne", "queryAll", "showToast"]) {
  if (!coreSource.includes(marker)) fail(`core bundle missing ${marker}`);
}
pass("core bundle exposes extracted helpers");

for (const marker of [
  "const $ = (sel) => window.VendifyCoreV232.queryOne(sel);",
  "const $$ = (sel) => window.VendifyCoreV232.queryAll(sel);",
  "window.VendifyCoreV232.formatArs(valor)",
  "window.VendifyCoreV232.escapeHtml(texto)",
  "window.VendifyCoreV232.showToast(mensaje, tipo)"
]) {
  if (!appSource.includes(marker)) fail(`compatibility app missing modular delegation ${marker}`);
}
pass("legacy runtime delegates active extracted helpers to modular core");

for (const obsoleteCoreImplementation of [
  "const $ = (sel) => document.querySelector(sel);",
  "const $$ = (sel) => document.querySelectorAll(sel);",
  'style: "currency", currency: "ARS"',
  'const div = document.createElement("div");',
  'const container = $("#toast-container");'
]) {
  if (sourceApp.includes(obsoleteCoreImplementation)) {
    fail(`root app.js still contains migrated Core implementation ${obsoleteCoreImplementation}`);
  }
}
pass("root app.js no longer duplicates migrated Core implementations");

for (const obsoleteBuildPatch of [
  '"DOM helpers"',
  '"currency formatter"',
  '"product display name"',
  '"HTML escaping"'
]) {
  if (buildSource.includes(obsoleteBuildPatch)) {
    fail(`build still patches compacted Core block ${obsoleteBuildPatch}`);
  }
}
pass("modular build no longer regex-patches compacted Core helpers");

const singleDollarDeclarations = [...appSource.matchAll(/^const \$ =/gm)].length;
const doubleDollarDeclarations = [...appSource.matchAll(/^const \$\$ =/gm)].length;
if (singleDollarDeclarations !== 1 || doubleDollarDeclarations !== 1) {
  fail(
    `expected exactly one $ and one $$ declaration, found $=${singleDollarDeclarations}, $$=${doubleDollarDeclarations}`
  );
}
pass("DOM helper declarations are collision-free");

if (!files.some((file) => /^vendify-offline-v2312-[0-9a-f]{12}\.js$/.test(file))) {
  fail("offline v2.31.2 runtime missing from refactor preview");
}
if (!files.some((file) => /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/.test(file))) {
  fail("pending sales UI missing from refactor preview");
}
pass("validated offline v2.31.2 staging runtime is preserved");

console.log("PASS: Vendify modular refactor preview verified");
