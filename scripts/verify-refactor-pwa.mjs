import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);
const coreFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));
if (!coreFile || !appFile) throw new Error("PWA verification could not find modular bundles");

const core = readFileSync(resolve(outputRoot, coreFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");
const generatedApp = readFileSync(resolve(outputRoot, appFile), "utf8");

for (const marker of [
  "VendifyPwaV232",
  "createPwaController",
  'navigator.serviceWorker.register("./sw.js")',
  "beforeinstallprompt",
  "kiosco_install_dismiss"
]) {
  if (!core.includes(marker)) throw new Error(`Modular core missing PWA marker: ${marker}`);
}
for (const app of [sourceApp, generatedApp]) {
  for (const marker of [
    "window.VendifyPwaV232.registerServiceWorker()",
    "window.VendifyPwaV232.setupInstallPrompt()"
  ]) {
    if (!app.includes(marker)) throw new Error(`Compatibility app missing PWA delegation: ${marker}`);
  }
  for (const obsolete of [
    "function setupInstallPrompt()",
    "deferredInstallPrompt",
    "INSTALL_DISMISS_KEY"
  ]) {
    if (app.includes(obsolete)) throw new Error(`Compatibility app retained PWA implementation: ${obsolete}`);
  }
}

console.log("PASS: root and generated runtimes delegate PWA install behavior to TypeScript");
