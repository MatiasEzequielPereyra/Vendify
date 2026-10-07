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

if (!existsSync(resolve(root, "index.html"))) {
  fail("refactor preview is missing index.html");
}

const index = readFileSync(resolve(root, "index.html"), "utf8");
const files = readdirSync(root);
const sources = [...index.matchAll(/src: "([^"]+\.js)"/gu)]
  .map((match) => match[1]);

const offline = sources.filter(
  (file) => /^vendify-offline-v2312-[0-9a-f]{12}\.js$/u.test(file)
);
const core = sources.filter(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/u.test(file)
);
const app = sources.filter(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
);
const pending = sources.filter(
  (file) =>
    /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/u.test(file)
);

if (core.length !== 1) {
  fail(`expected exactly one modular core, found ${core.length}`);
}
if (app.length !== 1) {
  fail(`expected exactly one typed application entry, found ${app.length}`);
}
if (offline.length !== 1) {
  fail(`expected exactly one offline runtime, found ${offline.length}`);
}
if (pending.length !== 1) {
  fail(`expected exactly one pending offline UI bundle, found ${pending.length}`);
}

for (const source of sources.filter(
  (value) => !/^https?:\/\//u.test(value)
)) {
  if (!existsSync(resolve(root, source))) {
    fail(`index references missing local bundle: ${source}`);
  }
}
pass("all local application bundles referenced by index exist");

const position = (file) => index.indexOf(`src: "${file}"`);
const order = [
  position(offline[0]),
  position(core[0]),
  position(app[0]),
  position(pending[0])
];
if (order.some((value) => value < 0)) {
  fail("one or more runtime entries are not present in index");
}
if (!(order[0] < order[1] && order[1] < order[2] && order[2] < order[3])) {
  fail("runtime order must be Offline -> modular core -> typed application -> pending offline UI");
}
pass("typed application loads after modular core in the required runtime order");

for (const forbidden of [
  "app-refactor-v232-",
  "app-staging-v2312-",
  'src: "app.js',
  'src: "./app.js'
]) {
  if (index.includes(forbidden)) {
    fail(`modular index retained forbidden compatibility runtime marker: ${forbidden}`);
  }
}
if (files.includes("app.js")) {
  fail("dist-refactor-modular still contains app.js");
}
if (
  files.some((file) =>
    /^app-(?:refactor-v232|staging-v2312)-/u.test(file)
  )
) {
  fail("dist-refactor-modular still contains a compatibility application bundle");
}
pass("modular artifact has no app.js or app-refactor/app-staging application runtime");

const corePath = resolve(root, core[0]);
const appPath = resolve(root, app[0]);
const coreSource = readFileSync(corePath, "utf8");
const appSource = readFileSync(appPath, "utf8");

try {
  execFileSync(process.execPath, ["--check", appPath], {
    stdio: "pipe"
  });
} catch (error) {
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? String(error.stderr)
      : String(error);
  fail(`generated typed application has invalid JavaScript syntax: ${stderr}`);
}
pass("generated typed application entry parses as JavaScript");

for (const marker of [
  "VendifyCoreV232",
  "VendifyAuthV232",
  "VendifyProductsV232",
  "VendifyRealtimeV232",
  "VendifyOfflineCompatV232",
  "VendifyPwaV232"
]) {
  if (!coreSource.includes(marker)) {
    fail(`modular core missing expected API marker: ${marker}`);
  }
}
pass("modular core retains expected typed owner APIs");

for (const marker of [
  "VendifyApplicationV232",
  "typed application entry loaded"
]) {
  if (!appSource.includes(marker)) {
    fail(`typed application bundle missing entry marker: ${marker}`);
  }
}
pass("typed application bundle exposes the Phase 13 application entry");

const sw = readFileSync(resolve(root, "sw.js"), "utf8");
if (sw.includes('"./app.js"') || sw.includes("'./app.js'")) {
  fail("modular Service Worker still requires app.js");
}
if (!sw.includes(`"./${app[0]}"`)) {
  fail("typed application entry is not included in the modular Service Worker shell");
}
pass("modular Service Worker precaches the typed application entry and not app.js");

console.log("PASS: Vendify typed modular runtime contract verified");
