import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
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
const coreMarker = `src="${core[0]}"`;
const appMarker = `src="${app[0]}"`;
const corePosition = index.indexOf(coreMarker);
const appPosition = index.indexOf(appMarker);
if (corePosition < 0 || appPosition < 0 || corePosition >= appPosition) {
  fail("modular core must load before the compatibility app");
}
pass("modular core loads before compatibility app");

const coreSource = readFileSync(resolve(root, core[0]), "utf8");
const appSource = readFileSync(resolve(root, app[0]), "utf8");

for (const marker of ["VendifyCoreV232", "formatArs", "productDisplayName", "escapeHtml", "queryOne", "queryAll"]) {
  if (!coreSource.includes(marker)) fail(`core bundle missing ${marker}`);
}
pass("core bundle exposes extracted helpers");

for (const marker of [
  "window.VendifyCoreV232.queryOne(sel)",
  "window.VendifyCoreV232.queryAll(sel)",
  "window.VendifyCoreV232.formatArs(valor)",
  "window.VendifyCoreV232.productDisplayName(p)",
  "window.VendifyCoreV232.escapeHtml(texto)"
]) {
  if (!appSource.includes(marker)) fail(`compatibility app missing modular delegation ${marker}`);
}
pass("legacy runtime delegates extracted helpers to modular core");

if (!files.some((file) => /^vendify-offline-v2312-[0-9a-f]{12}\.js$/.test(file))) {
  fail("offline v2.31.2 runtime missing from refactor preview");
}
if (!files.some((file) => /^vendify-offline-v2312-pending-ui-[0-9a-f]{12}\.js$/.test(file))) {
  fail("pending sales UI missing from refactor preview");
}
pass("validated offline v2.31.2 staging runtime is preserved");

console.log("PASS: Vendify modular refactor preview verified");
