import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file));
if (!runtimeFile || !appFile) throw new Error("Refactor Realtime verification could not find generated bundles");

const runtime = readFileSync(resolve(outputRoot, runtimeFile), "utf8");
const app = readFileSync(resolve(outputRoot, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const stockService = readFileSync(
  resolve(projectRoot, "src/products/realtime-stock-service.ts"),
  "utf8"
);

for (const marker of [
  "VendifyRealtimeV232",
  "createRealtimeController",
  "CHANNEL_ERROR",
  "TIMED_OUT",
  "dependent-refresh",
  "smart-stock-refresh"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Realtime marker: ${marker}`);
}

for (const marker of [
  "realtimeApi.createController({",
  "realtimeController.subscribe()",
  "realtimeController.disconnect()",
  "realtimeController.emitStockChange",
  "realtimeController.refreshDependentViews",
  "realtimeController.startWatchdog()"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Realtime delegation: ${marker}`);
  }
}

for (const stockMarker of [
  '.from("producto_stock_sucursal")',
  '.select("producto_id,stock,stock_minimo")',
  '.eq("sucursal_id", branchId)'
]) {
  if (!stockService.includes(stockMarker)) {
    throw new Error(`Typed Realtime stock service missing audited marker: ${stockMarker}`);
  }
  if (sourceApp.includes(stockMarker)) {
    throw new Error(`Application composition leaked Realtime stock backend access: ${stockMarker}`);
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

console.log("PASS: typed application delegates Realtime coordination and branch stock access to typed owners");
