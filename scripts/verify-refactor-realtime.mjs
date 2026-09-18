import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));
if (!runtimeFile || !appFile) throw new Error("Refactor Realtime verification could not find generated bundles");

const runtime = readFileSync(resolve(outputRoot, runtimeFile), "utf8");
const app = readFileSync(resolve(outputRoot, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyRealtimeV232",
  "createRealtimeController",
  "producto_stock_sucursal",
  "CHANNEL_ERROR",
  "TIMED_OUT",
  "dependent-refresh",
  "smart-stock-refresh"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Realtime marker: ${marker}`);
}

for (const marker of [
  "window.VendifyRealtimeV232.createController({",
  "realtimeControllerV232.subscribe()",
  "realtimeControllerV232.disconnect()",
  "realtimeControllerV232.emitStockChange",
  "realtimeControllerV232.refreshDependentViews",
  "realtimeControllerV232.startWatchdog()"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Realtime delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  "let realtimeChannel",
  "function suscribirRealtime",
  "function iniciarWatchdogRealtime",
  "function sincronizarCatalogoCompletoVQA",
  "function sincronizarStockLigero",
  "function programarReconexionRealtime",
  "function recibirCambioStockRealtime",
  "function emitirCambioStockRealtime"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Realtime implementation: ${obsoleteMarker}`);
  }
}

console.log("PASS: root and generated runtimes delegate Realtime coordination to TypeScript");
