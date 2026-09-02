import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Dashboard verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyDashboardV232",
  "loadDashboard",
  "loadOperationalAlerts",
  "dashboard_propietario_v1",
  "alertas_operativas_v1"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Dashboard marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyDashboardV232.loadDashboard(",
  "window.VendifyDashboardV232.loadOperationalAlerts("
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Dashboard delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  'supabaseClient.rpc(\n      "dashboard_propietario_v1"',
  'supabaseClient.rpc(\n      "alertas_operativas_v1"'
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Dashboard data access: ${obsoleteMarker}`);
  }
}

console.log("PASS: root and generated runtimes delegate Dashboard data access to TypeScript");
