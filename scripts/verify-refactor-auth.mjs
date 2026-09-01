import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) throw new Error("Refactor Auth verification could not find generated bundles");

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");

for (const marker of [
  "VendifyAuthV232",
  "normalizeInternalLogin",
  "buildEmployeeInternalEmail",
  "resolveAuthPanel"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Auth marker: ${marker}`);
}

for (const marker of [
  "window.VendifyAuthV232.normalizeInternalLogin(valor)",
  "window.VendifyAuthV232.buildEmployeeInternalEmail(codigoNegocio, username)",
  "window.VendifyAuthV232.resolveAuthPanel(panel)"
]) {
  if (!app.includes(marker)) throw new Error(`Compatibility app missing Auth delegation: ${marker}`);
}

console.log("PASS: generated refactor runtime exposes and delegates first Auth slice");
