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
const typedOverlayOwner = readFileSync(
  resolve(projectRoot, "src/core/overlay-stability.ts"),
  "utf8"
);
const typedNavigationOwner = readFileSync(
  resolve(
    projectRoot,
    "src/core/navigation-events-controller.ts"
  ),
  "utf8"
);

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


const typedConnectionOwner = readFileSync(
  resolve(projectRoot, "src/offline/connection-status-controller.ts"),
  "utf8"
);
const offlineBridge = readFileSync(
  resolve(projectRoot, "src/legacy/offline-bridge.ts"),
  "utf8"
);
const browserAcceptance = readFileSync(
  resolve(projectRoot, "scripts/run-pwa-browser-acceptance.mjs"),
  "utf8"
);

for (const marker of [
  "createConnectionStatusController",
  "#connection-status-v23011",
  "#connection-label-v23011",
  "#btn-sync-now-v23011",
  "Sin conexión",
  "Sincronizando",
  "Error de sync",
  "#vi-wifi-off",
  "#vi-wifi"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Connection Status marker: ${marker}`);
  }
}
for (const marker of [
  "readonly createConnectionStatusController: typeof createConnectionStatusController",
  "createConnectionStatusController"
]) {
  if (!offlineBridge.includes(marker)) {
    throw new Error(`Offline bridge missing Connection Status API marker: ${marker}`);
  }
}
for (const compatibilityApp of [sourceApp, app]) {
  for (const marker of [
    "window.VendifyOfflineCompatV232.createConnectionStatusController({",
    "getPendingOfflineSalesCount: () => leerVentasOfflineV2311().length",
    "syncPendingOfflineSales: () =>",
    "syncAll: (showToast) =>",
    "connectionStatusControllerV232.setup();",
    "connectionStatusControllerV232.setState(",
    "setConnectionState: (state, label) => connectionStatusControllerV232.setState(state, label)"
  ]) {
    if (!compatibilityApp.includes(marker)) {
      throw new Error(`Compatibility app missing Connection Status composition: ${marker}`);
    }
  }
  for (const obsolete of [
    "function setConnectionStateV23011",
    "function actualizarEstadoConexionV23011"
  ]) {
    if (compatibilityApp.includes(obsolete)) {
      throw new Error(`Compatibility app retained legacy Connection Status owner: ${obsolete}`);
    }
  }
}
const stabilityStartV007d = sourceApp.indexOf("function setupStabilityV23011()");
const stabilityEndV007d = sourceApp.indexOf(
  "overlayStabilityControllerV232.setup();",
  stabilityStartV007d
);
if (stabilityStartV007d < 0 || stabilityEndV007d < 0) {
  throw new Error("Could not inspect setupStabilityV23011 Connection Status boundary");
}
const stabilitySetupV007d = sourceApp.slice(stabilityStartV007d, stabilityEndV007d);
for (const forbidden of [
  'window.addEventListener("online"',
  'window.addEventListener("offline"',
  "#connection-status-v23011",
  "#btn-sync-now-v23011",
  "sincronizarVentasOfflineV2311(",
  "sincronizarTodoV23011({"
]) {
  if (stabilitySetupV007d.includes(forbidden)) {
    throw new Error(`setupStabilityV23011 still owns Connection Status behavior: ${forbidden}`);
  }
}
for (const marker of [
  "window.VendifyCoreV232.createOverlayStabilityController({",
  "overlayStabilityControllerV232.setup();"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(
      `Overlay Stability composition disappeared: ${marker}`
    );
  }
}
for (const marker of [
  "const escapeTargets: NavigationModalTarget[] = [",
  'documentRef.addEventListener(\n      "keydown",\n      handleGlobalKeydown'
]) {
  if (!typedNavigationOwner.includes(marker)) {
    throw new Error(
      `Typed global Escape router disappeared: ${marker}`
    );
  }
}
for (const retiredMarker of [
  "function modalVisibleV23011",
  "function cerrarMenusFlotantesV23011",
  "function sincronizarEstadoOverlaysV23011",
  "function setupOverlayStabilityV23011"
]) {
  if (sourceApp.includes(retiredMarker)) {
    throw new Error(`Legacy Overlay Stability owner returned to app.js: ${retiredMarker}`);
  }
}
for (const marker of [
  'documentRef.addEventListener("keydown", handleEscape);',
  'if (event.key !== "Escape") return;',
  'attributeFilter: ["class", "hidden"]',
  '"vendify-modal-open-v23011"',
  "dependencies.closeUserMenu();",
  "dependencies.closeManagementMenu();",
  "dependencies.closeContextPickers();"
]) {
  if (!typedOverlayOwner.includes(marker)) {
    throw new Error(`Typed Overlay Stability owner missing behavior: ${marker}`);
  }
}
for (const forbidden of [
  "supabaseClient",
  "registrar_venta_v4",
  "cargarProductos",
  "cargarEstadoCajaV227",
  "inventoryControllerV232",
  "purchasesControllerV232",
  "sincronizarVentasOfflineV2311",
  "leerVentasOfflineV2311"
]) {
  if (typedConnectionOwner.includes(forbidden)) {
    throw new Error(`Connection Status UI crossed sync/backend boundary: ${forbidden}`);
  }
}
for (const forbidden of [
  "createConnectionStatusController({",
  "cloneNode(true)",
  ".replaceWith("
]) {
  if (browserAcceptance.includes(forbidden)) {
    throw new Error(`Browser acceptance substitutes real Connection Status composition: ${forbidden}`);
  }
}
for (const marker of [
  "connectionStatusInitialOnline",
  'window.dispatchEvent(new Event("offline"))',
  'Object.defineProperty(navigator, "onLine"',
  'runtimeComposition: "real-app-init-and-listeners"'
]) {
  if (!browserAcceptance.includes(marker)) {
    throw new Error(`Browser acceptance missing real Connection Status proof: ${marker}`);
  }
}

console.log("PASS: root app delegates Offline routing and Connection Status UI ownership to TypeScript");
