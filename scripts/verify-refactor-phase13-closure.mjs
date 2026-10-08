import {
  existsSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "dist-refactor-modular");

const fail = (message) => {
  throw new Error(`Phase 13 closure failed: ${message}`);
};

const index = readFileSync(resolve(outputRoot, "index.html"), "utf8");
const sw = readFileSync(resolve(outputRoot, "sw.js"), "utf8");
const files = readdirSync(outputRoot);

const entrySource = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-entry.ts"),
  "utf8"
);
const bootstrapSource = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-bootstrap.ts"),
  "utf8"
);
const compositionSource = readFileSync(
  resolve(projectRoot, "src/bootstrap/application-composition.ts"),
  "utf8"
);
const stockSource = readFileSync(
  resolve(projectRoot, "src/products/realtime-stock-service.ts"),
  "utf8"
);
const buildSource = readFileSync(
  resolve(projectRoot, "scripts/build-refactor-modular.mjs"),
  "utf8"
);

if (
  files.some((file) => /^app-refactor-v232-/u.test(file))
  || index.includes("app-refactor-v232-")
) {
  fail("app-refactor-v232 compatibility runtime returned");
}
if (index.includes("app.js") || files.includes("app.js")) {
  fail("modular artifact references or contains app.js");
}
if (sw.includes('"./app.js"') || sw.includes("'./app.js'")) {
  fail("modular Service Worker requires app.js");
}
if (!files.some((file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/u.test(file))) {
  fail("typed application bundle is missing");
}

for (const marker of [
  "createBrowserApplicationComposition",
  "window.VendifyApplicationV232",
  "scheduleApplicationStart"
]) {
  if (!entrySource.includes(marker)) {
    fail(`typed application entry missing marker: ${marker}`);
  }
}
if (
  !/const composition\s*=\s*window\.VendifyApplicationV232\s*\?\?\s*createBrowserApplicationComposition\(\);/u.test(
    entrySource
  )
) {
  fail("application entry is missing explicit global composition guard");
}
if (!bootstrapSource.includes("if (started) return true;")) {
  fail("application bootstrap is missing explicit idempotent start guard");
}
if (!bootstrapSource.includes("authenticatedBootPromise")) {
  fail("authenticated boot is missing single-flight protection");
}

for (const retired of [
  "async function mostrarApp()",
  "function mostrarApp()",
  "function init()"
]) {
  if (entrySource.includes(retired) || compositionSource.includes(retired)) {
    fail(`typed modular runtime restored legacy bootstrap owner: ${retired}`);
  }
}

if (
  compositionSource.includes('.from("producto_stock_sucursal")')
  || bootstrapSource.includes('.from("producto_stock_sucursal")')
) {
  fail("application bootstrap/composition contains direct Realtime stock backend access");
}
for (const marker of [
  '.from("producto_stock_sucursal")',
  '.select("producto_id,stock,stock_minimo")',
  '.eq("sucursal_id", branchId)'
]) {
  if (!stockSource.includes(marker)) {
    fail(`typed Realtime stock service lost audited query semantics: ${marker}`);
  }
}

const owners = [
  "authApi.createController({",
  "authApi.createInactivityGuard({",
  "teamApi.createController({",
  "realtimeApi.createController({",
  "productsApi.createStore()",
  "productsApi.createController({",
  "productsApi.createScannerController({",
  "observabilityApi.createDiagnosticsController({",
  "core.createNavigationEventsController({",
  "core.createOverlayStabilityController({",
  "core.createOnboardingController({",
  "dashboardApi.createController({",
  "platformApi.createPlatformAdminController({",
  "commercialApi.createCommercialFoundationController({",
  "inventoryApi.createController({",
  "inventoryApi.createBranchTransferController({",
  "purchasesApi.createController({",
  "salesApi.createDiscountController({",
  "salesApi.createHistoryController({",
  "salesApi.createPosController({",
  "cashApi.createController({",
  "branchesApi.createActiveBranchController({",
  "branchesApi.createBranchAdministrationController({",
  "contextApi.createContextPickerController({",
  "offlineApi.createConnectionStatusController({",
  "offlineApi.createController({"
];

for (const owner of owners) {
  const count = compositionSource.split(owner).length - 1;
  if (count !== 1) {
    fail(`expected exactly one typed owner composition for ${owner}, found ${count}`);
  }
}

for (const marker of [
  "resolveStagingSupabaseConfig",
  "stagingExpectedProjectRef",
  "__VENDIFY_EXPECTED_SUPABASE_REF__",
  'vite.refactor-app.config.ts',
  'vendify-app-v232-',
  'const copiedAppPath = resolve(out, "app.js")'
]) {
  if (!buildSource.includes(marker)) {
    fail(`modular build lost Phase 13 safety marker: ${marker}`);
  }
}

if (
  /writeFileSync\(resolve\(out,\s*["']app-refactor-v232-/u.test(buildSource)
) {
  fail("modular build writes a renamed compatibility app");
}

for (const forbidden of [
  "service_role",
  "SUPABASE_SERVICE_ROLE_KEY"
]) {
  if (entrySource.includes(forbidden) || compositionSource.includes(forbidden)) {
    fail(`typed application source contains forbidden credential marker: ${forbidden}`);
  }
}

console.log("PASS: VEN-007M Phase 13 closure anti-regression contract");
