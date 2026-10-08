import {
  existsSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(outputRoot);

const runtimeFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/u.test(file)
);
const offlineRuntimeFile = files.find(
  (file) => /^vendify-offline-v2312-[0-9a-f]{12}\.js$/u.test(file)
);
const appFile = files.find(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file)
);
if (!runtimeFile || !offlineRuntimeFile || !appFile) {
  throw new Error(
    "Refactor Offline verification could not find typed modular bundles"
  );
}

const runtime = readFileSync(resolve(outputRoot, runtimeFile), "utf8");
const offlineRuntime = readFileSync(
  resolve(outputRoot, offlineRuntimeFile),
  "utf8"
);
const composition = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-composition.ts"),
  "utf8"
);
const bootstrap = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-bootstrap.ts"),
  "utf8"
);
const offlineStorage = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-offline-storage.ts"),
  "utf8"
);
const productCache = readFileSync(
  resolve(projectRoot, "src/products/products-offline-cache.ts"),
  "utf8"
);
const productsBridge = readFileSync(
  resolve(projectRoot, "src/legacy/products-bridge.ts"),
  "utf8"
);
const typedOverlayOwner = readFileSync(
  resolve(projectRoot, "src/core/overlay-stability.ts"),
  "utf8"
);
const typedNavigationOwner = readFileSync(
  resolve(projectRoot, "src/core/navigation-events-controller.ts"),
  "utf8"
);
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
  "VendifyOfflineCompatV232",
  "createOfflineCompatController",
  "vendify_offline_sales_v2311",
  "vendify_cash_proof_v2311",
  "registrar_venta_v4",
  "createOfflinePosIntegration",
  "VendifyOfflineIntegrationV232",
  "pendiente_sincronizacion",
  "createConnectionStatusController"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular core missing Offline marker: ${marker}`);
  }
}

for (const marker of [
  "registrar_venta_offline_v1",
  "emitir_lease_venta_offline_v1",
  "acquireLease"
]) {
  if (!offlineRuntime.includes(marker)) {
    throw new Error(
      `IndexedDB runtime missing Offline lease marker: ${marker}`
    );
  }
}

for (const marker of [
  "offlineApi.createController({",
  "offlineApi.createConnectionStatusController({",
  "offlineController.readLegacySales().length",
  "offlineController.restoreCashProof()",
  "offlineController.applySaleState()",
  "offlineController.registerSale(",
  "offlineController.sync({",
  "offlineController.setup()",
  "connectionStatusController.setup()",
  "connectionStatusController.setState(",
  "setConnectionState: (state, label) =>"
]) {
  if (!composition.includes(marker)) {
    throw new Error(
      `Typed application missing Offline composition: ${marker}`
    );
  }
}

for (const marker of [
  "const bootOfflineAuthenticated =",
  "offlineStorage.restoreCatalog();",
  "contextAdapter.applyPermissions();",
  "contextPickerController.updateLabels();",
  "offlineController.restoreCashProof();",
  "offlineController.updateUi();",
  "offlineStorage.restoreCart()",
  "offlineController.applySaleState();"
]) {
  if (!composition.includes(marker)) {
    throw new Error(
      `Offline authenticated boot lost behavior: ${marker}`
    );
  }
}

for (const marker of [
  "isOfflineAuthenticatedMode",
  "bootOfflineAuthenticated",
  "bootOnlineAuthenticated"
]) {
  if (!bootstrap.includes(marker) && !composition.includes(marker)) {
    throw new Error(
      `Typed lifecycle lost Offline routing marker: ${marker}`
    );
  }
}

for (const marker of [
  "serializeProductCatalogCache",
  "parseProductCatalogCache",
  "migrateLegacyProductCache"
]) {
  if (!new RegExp(`export function ${marker}\\s*\\(`, "u").test(productCache)) {
    throw new Error(`Typed Products cache source lost ${marker}`);
  }
}

for (const marker of [
  "serializeCatalog",
  "parseCatalog",
  "migrateLegacyCatalog",
  "restoreCatalog",
  "persistCatalog",
  "restoreCart",
  "persistCart"
]) {
  if (!offlineStorage.includes(marker)) {
    throw new Error(
      `Typed offline application storage missing marker: ${marker}`
    );
  }
}

for (const marker of [
  "serializeOfflineCache: serializeProductCatalogCache",
  "parseOfflineCache: parseProductCatalogCache",
  "migrateLegacyOfflineCache: migrateLegacyProductCache"
]) {
  if (!productsBridge.includes(marker)) {
    throw new Error(`Products bridge lost offline cache delegation: ${marker}`);
  }
}
for (const marker of [
  "serializeCatalog: productsApi.serializeOfflineCache",
  "parseCatalog: productsApi.parseOfflineCache",
  "migrateLegacyCatalog: productsApi.migrateLegacyOfflineCache"
]) {
  if (!composition.includes(marker)) {
    throw new Error(`Application composition lost Products cache injection: ${marker}`);
  }
}
for (const marker of [
  "dependencies.serializeCatalog(",
  "dependencies.parseCatalog(",
  "dependencies.migrateLegacyCatalog("
]) {
  if (!offlineStorage.includes(marker)) {
    throw new Error(`Application Offline Storage lost injected cache call: ${marker}`);
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
  if (composition.includes(obsoleteMarker)) {
    throw new Error(
      `Typed application retained migrated Offline implementation: ${obsoleteMarker}`
    );
  }
}

for (const obsoleteGlobal of [
  "registrarVentaOfflineIndexedDbV2312",
  "sincronizarVentasOfflineIndexedDbV2312",
  "listarVentasOfflineIndexedDbV2312"
]) {
  if (
    runtime.includes(obsoleteGlobal)
    || composition.includes(obsoleteGlobal)
  ) {
    throw new Error(
      `Obsolete Offline POS bridge global remains: ${obsoleteGlobal}`
    );
  }
}

if (existsSync(resolve(projectRoot, "src/offline/legacy-pos-bridge.ts"))) {
  throw new Error("Obsolete Offline POS bridge source still exists");
}

for (const marker of [
  "readonly createConnectionStatusController: typeof createConnectionStatusController",
  "createConnectionStatusController"
]) {
  if (!offlineBridge.includes(marker)) {
    throw new Error(
      `Offline bridge missing Connection Status API marker: ${marker}`
    );
  }
}

for (const marker of [
  "core.createOverlayStabilityController({",
  "overlayStabilityController.setup()"
]) {
  if (!composition.includes(marker)) {
    throw new Error(
      `Overlay Stability composition disappeared: ${marker}`
    );
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
    throw new Error(
      `Typed Overlay Stability owner missing behavior: ${marker}`
    );
  }
}

for (const marker of [
  "const escapeTargets: NavigationModalTarget[] = ["
]) {
  if (!typedNavigationOwner.includes(marker)) {
    throw new Error(
      `Typed global Escape router disappeared: ${marker}`
    );
  }
}
if (!/documentRef\s*\.addEventListener\(\s*"keydown"\s*,\s*handleGlobalKeydown\s*\)/u.test(typedNavigationOwner)) {
  throw new Error("Typed Navigation Events owner lost the global Escape keydown route");
}

for (const forbidden of [
  "supabaseClient",
  "registrar_venta_v4",
  "cargarProductos",
  "cargarEstadoCajaV227",
  "inventoryController",
  "purchasesController",
  "sincronizarVentasOfflineV2311",
  "leerVentasOfflineV2311"
]) {
  if (typedConnectionOwner.includes(forbidden)) {
    throw new Error(
      `Connection Status UI crossed sync/backend boundary: ${forbidden}`
    );
  }
}

for (const forbidden of [
  "createConnectionStatusController({",
  "cloneNode(true)",
  ".replaceWith("
]) {
  if (browserAcceptance.includes(forbidden)) {
    throw new Error(
      `Browser acceptance substitutes real Connection Status composition: ${forbidden}`
    );
  }
}

for (const marker of [
  "connectionStatusInitialOnline",
  'window.dispatchEvent(new Event("offline"))',
  'Object.defineProperty(navigator, "onLine"',
  "VendifyApplicationV232",
  "window.VendifyApplicationV232?.controllers.cash",
  "typed application runtime identity"
]) {
  if (!browserAcceptance.includes(marker)) {
    throw new Error(
      `Browser acceptance missing real typed Offline proof: ${marker}`
    );
  }
}
if (browserAcceptance.includes("cashControllerV232")) {
  throw new Error("Browser acceptance still depends on the retired Cash global");
}

console.log(
  "PASS: typed application preserves Offline, Connection Status, Overlay, cached authenticated boot, and real browser composition"
);
