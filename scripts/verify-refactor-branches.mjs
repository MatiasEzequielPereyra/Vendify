import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);

const runtimeFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file)
);

const appFile = files.find(
  (file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file)
);

if (!runtimeFile || !appFile) {
  throw new Error(
    "Refactor Branch Administration verification could not find generated bundles"
  );
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

const controllerSource = readFileSync(
  resolve(
    projectRoot,
    "src/branches/branch-administration-controller.ts"
  ),
  "utf8"
);

const bridgeSource = readFileSync(
  resolve(projectRoot, "src/legacy/branches-bridge.ts"),
  "utf8"
);

for (const marker of [
  "VendifyBranchesV232",
  "createBranchAdministrationController",
  "listAdminBranches",
  "createBranch",
  "updateBranch",
  "createCashRegister",
  "setCashRegisterActive"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(
      `Modular runtime missing Branch Administration marker: ${marker}`
    );
  }
}

for (const marker of [
  "window.VendifyBranchesV232.createBranchAdministrationController({",
  "const branchAdministrationControllerV232 =",
  "branchAdministrationControllerV232.setup();",
  "refreshBranchSettings: () => branchAdministrationControllerV232.render(),"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(
      `Root app.js missing Branch Administration composition: ${marker}`
    );
  }

  if (!app.includes(marker)) {
    throw new Error(
      `Compatibility app missing Branch Administration composition: ${marker}`
    );
  }
}

if (!bridgeSource.includes("createBranchAdministrationController")) {
  throw new Error(
    "Branches bridge does not expose createBranchAdministrationController"
  );
}

for (const retainedMarker of [
  "let sucursalesV226",
  "async function inicializarSucursalActivaV226",
  "function renderSelectorSucursalesV226",
  "async function cambiarSucursalDesdeSelectorV226",
  "async function refrescarSucursalesV226",
  "async function listarSucursalesV2",
  "async function cambiarSucursalV2"
]) {
  if (!sourceApp.includes(retainedMarker)) {
    throw new Error(
      `Root app.js lost retained active-branch lifecycle marker: ${retainedMarker}`
    );
  }

  if (!app.includes(retainedMarker)) {
    throw new Error(
      `Compatibility app lost retained active-branch lifecycle marker: ${retainedMarker}`
    );
  }
}

for (const obsoleteMarker of [
  "async function listarSucursalesAdminV226",
  "async function renderSucursalesConfigV226",
  "function abrirModalSucursalV226",
  "function cerrarModalSucursalV226",
  "async function guardarSucursalV226",
  "function abrirModalCajaV226",
  "function cerrarModalCajaV226",
  "async function crearCajaV226"
]) {
  if (sourceApp.includes(obsoleteMarker) || app.includes(obsoleteMarker)) {
    throw new Error(
      `Legacy app still contains migrated Branch Administration logic: ${obsoleteMarker}`
    );
  }
}

const normalizedSourceApp = sourceApp.replace(/\r\n/g, "\n");

const setupStart = normalizedSourceApp.indexOf(
  "function setupSucursalesV226() {"
);

const initStart = normalizedSourceApp.indexOf(
  "function init() {",
  setupStart
);

if (setupStart === -1 || initStart === -1 || initStart <= setupStart) {
  throw new Error(
    "Could not isolate setupSucursalesV226 for Branch Administration verification"
  );
}

const setupBody = normalizedSourceApp.slice(setupStart, initStart);

for (const retainedSetupMarker of [
  '#branch-selector-v226',
  'cambiarSucursalDesdeSelectorV226',
  'branchTransferControllerV232.setup();',
  'branchAdministrationControllerV232.setup();'
]) {
  if (!setupBody.includes(retainedSetupMarker)) {
    throw new Error(
      `setupSucursalesV226 missing retained composition: ${retainedSetupMarker}`
    );
  }
}

for (const migratedSetupMarker of [
  "btn-nueva-sucursal-v226",
  "form-sucursal-v226",
  "btn-cerrar-sucursal-v226",
  "btn-cancelar-sucursal-v226",
  "modal-sucursal-v226",
  "form-caja-v226",
  "btn-cerrar-caja-v226",
  "btn-cancelar-caja-v226",
  "modal-caja-v226",
  'data-config-tab="sucursales"',
  'data-config-go="sucursales"'
]) {
  if (setupBody.includes(migratedSetupMarker)) {
    throw new Error(
      `setupSucursalesV226 still owns Branch Administration listener: ${migratedSetupMarker}`
    );
  }
}

if (controllerSource.includes(".rpc(")) {
  throw new Error(
    "Typed Branch Administration controller must not call RPC directly"
  );
}

if (controllerSource.includes("window.Vendify")) {
  throw new Error(
    "Typed Branch Administration controller must not depend on legacy Vendify globals"
  );
}

if (
  controllerSource.includes("VendifyBranchAdminV232") ||
  bridgeSource.includes("VendifyBranchAdminV232") ||
  sourceApp.includes("VendifyBranchAdminV232")
) {
  throw new Error(
    "Branch Administration introduced forbidden duplicate global VendifyBranchAdminV232"
  );
}

for (const serviceImportMarker of [
  "listAdminBranches",
  "createBranch",
  "updateBranch",
  "createCashRegister",
  "setCashRegisterActive"
]) {
  if (!controllerSource.includes(serviceImportMarker)) {
    throw new Error(
      `Typed Branch Administration controller missing typed service usage: ${serviceImportMarker}`
    );
  }
}

console.log(
  "PASS: root and generated runtimes delegate Branch Administration UI ownership to TypeScript while active-branch lifecycle remains legacy composition"
);
