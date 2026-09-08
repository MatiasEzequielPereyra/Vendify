import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const targetArg = process.argv[2] ?? ".";
const target = resolve(projectRoot, targetArg);
const fragments = [
  "html/01-auth-shell.html",
  "html/02-app-shell.html",
  "html/03-product-stock-modals.html",
  "html/04-inventory-purchases-modals.html",
  "html/05-team-access-modals.html",
  "html/06-dashboard-admin-modals.html",
  "html/07-cash-sales-modals.html"
];
const expectedMarkupHash = "74c32c567b3d9ebdf35e2107a0357e6bc7bd09d0ac4f11047380a46f11dcb0ab";
const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exit(1);
};
const pass = (message) => console.log(`PASS: ${message}`);

for (const file of ["index.html", "html-loader.js", "sw.js", ...fragments]) {
  if (!existsSync(resolve(target, file))) fail(`modular HTML release missing ${file}`);
}

const index = readFileSync(resolve(target, "index.html"), "utf8");
const loader = readFileSync(resolve(target, "html-loader.js"), "utf8");
const serviceWorker = readFileSync(resolve(target, "sw.js"), "utf8");
const parts = fragments.map((file) => readFileSync(resolve(target, file), "utf8"));
const markup = parts.join("");

if (index.split(/\r?\n/).length > 100 || Buffer.byteLength(index) > 6_000) {
  fail("root index.html grew beyond the compact compatibility shell budget");
}
pass("root index.html is a compact compatibility shell");

let previousPosition = -1;
for (const fragment of fragments) {
  const position = index.indexOf(`"${fragment}"`);
  if (position < 0) fail(`index bootstrap does not reference ${fragment}`);
  if (position <= previousPosition) fail("HTML fragments are not declared in their validated DOM order");
  previousPosition = position;
}
pass("HTML fragments are declared in validated DOM order");

const actualMarkupHash = createHash("sha256").update(markup).digest("hex");
if (actualMarkupHash !== expectedMarkupHash) {
  fail(`fragment markup changed unexpectedly (${actualMarkupHash})`);
}
pass("fragment concatenation matches the validated legacy body byte-for-byte");

if (/<script\b/i.test(markup)) fail("HTML fragments must not execute scripts");
const ids = [...markup.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
const uniqueIds = new Set(ids);
if (ids.length !== 570 || uniqueIds.size !== ids.length) {
  fail(`expected 570 unique fragment IDs, found ${ids.length} IDs / ${uniqueIds.size} unique`);
}
pass("all 570 functional DOM IDs remain unique");

const criticalOrder = [
  'id="auth-screen"',
  'class="app hidden"',
  'id="modal"',
  'id="modal-inventario"',
  'id="modal-equipo"',
  'id="modal-dashboard-v231"',
  'id="modal-caja-operativa-v227"',
  'id="modal-venta"'
];
previousPosition = -1;
for (const marker of criticalOrder) {
  const position = markup.indexOf(marker);
  if (position < 0 || position <= previousPosition) fail(`critical DOM marker out of order: ${marker}`);
  previousPosition = position;
}
pass("auth, app and modal sections preserve runtime order");

for (const marker of [
  "Promise.all(config.fragments.map(readFragment))",
  "mount.replaceWith(template.content)",
  "for (const script of config.scripts) await loadScript(script)",
  "void bootstrap().catch(showFatalError)"
]) {
  if (!loader.includes(marker)) fail(`HTML loader missing safety marker: ${marker}`);
}
try {
  execFileSync(process.execPath, ["--check", resolve(target, "html-loader.js")], { stdio: "pipe" });
} catch {
  fail("html-loader.js syntax is invalid");
}
pass("HTML loader mounts fragments before loading the runtime sequentially");

for (const file of ["html-loader.js", ...fragments]) {
  if (!serviceWorker.includes(`./${file}`)) fail(`service worker does not cache ${file}`);
}
if (!serviceWorker.includes('vendify-shell-v235-pinned-runtime')) fail("service worker HTML cache was not bumped");
pass("offline shell caches the complete modular HTML");

const app = readFileSync(resolve(target, "app.js"), "utf8");
if (
  !app.includes('if (document.readyState === "loading")') ||
  !app.includes('document.addEventListener("DOMContentLoaded", init, { once: true })') ||
  !app.includes("void init();")
) {
  fail("app bootstrap is not safe when fragments finish after DOMContentLoaded");
}
pass("app initialization supports asynchronous fragment completion");

console.log(`PASS: modular HTML verified in ${targetArg}`);
