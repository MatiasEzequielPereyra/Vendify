import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const offlineRuntimeFile = files.find((file) => /^vendify-offline-v2312-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));
if (!runtimeFile || !offlineRuntimeFile || !appFile) {
  throw new Error("Refactor Offline verification could not find generated bundles");
}

const runtime = readFileSync(resolve(outputRoot, runtimeFile), "utf8");
const offlineRuntime = readFileSync(resolve(outputRoot, offlineRuntimeFile), "utf8");
const app = readFileSync(resolve(outputRoot, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyOfflineCompatV232",
  "createOfflineCompatController",
  "vendify_offline_sales_v2311",
  "vendify_cash_proof_v2311",
  "registrar_venta_v4",
  "createOfflinePosIntegration",
  "VendifyOfflineIntegrationV232",
  "pendiente_sincronizacion"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Offline marker: ${marker}`);
}

for (const marker of [
  "registrar_venta_offline_v1",
  "emitir_lease_venta_offline_v1",
  "acquireLease"
]) {
  if (!offlineRuntime.includes(marker)) {
    throw new Error(`IndexedDB runtime missing Offline lease marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyOfflineCompatV232.createController({",
  "offlineControllerV232.readLegacySales()",
  "offlineControllerV232.persistCashProof()",
  "offlineControllerV232.restoreCashProof()",
  "offlineControllerV232.applySaleState()",
  "offlineControllerV232.registerLegacySale(items, pagos, totales, observacion)",
  "offlineControllerV232.registerSale(items, payments, totals, observation)",
  "offlineControllerV232.sync(options)",
  "offlineControllerV232.setup()",
  "renderSaleProducts: renderVentaProductos",
  "renderCart: renderCarrito"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Offline delegation: ${marker}`);
  }
}

for (const invalidBinding of [
  "\n  renderSaleProducts,",
  "\n  renderCart,"
]) {
  if (app.includes(invalidBinding) || sourceApp.includes(invalidBinding)) {
    throw new Error(`Offline controller contains an unresolved legacy binding: ${invalidBinding.trim()}`);
  }
}

for (const obsoleteMarker of [
  "VENDIFY_OFFLINE_SALES_PREFIX_V2311",
  "VENDIFY_OFFLINE_MAX_SALES_V2311",
  "offlineSalesSyncPromiseV2311",
  "function offlineSalesKeyV2311",
  "function cashProofKeyV2311",
  "function guardarVentasOfflineV2311",
  "function resumenColaOfflineV2311",
  "function puedeCobrarOfflineV2311",
  "function esErrorRedV2311",
  'supabaseClient.rpc(\n          "registrar_venta_v4"'
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Offline implementation: ${obsoleteMarker}`);
  }
}

for (const obsoleteGlobal of [
  "registrarVentaOfflineIndexedDbV2312",
  "sincronizarVentasOfflineIndexedDbV2312",
  "listarVentasOfflineIndexedDbV2312"
]) {
  if (runtime.includes(obsoleteGlobal) || app.includes(obsoleteGlobal) || sourceApp.includes(obsoleteGlobal)) {
    throw new Error(`Obsolete Offline POS bridge global remains: ${obsoleteGlobal}`);
  }
}

if (existsSync(resolve(projectRoot, "src/offline/legacy-pos-bridge.ts"))) {
  throw new Error("Obsolete Offline POS bridge source still exists");
}

console.log("PASS: root app delegates legacy fallback and IndexedDB Offline routing to TypeScript");
