import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);

const runtimeFile = files.find(
  (file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file)
);
const appFile = files.find(
  (file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file)
);

if (!runtimeFile || !appFile) {
  throw new Error(
    "Refactor Branch Administration verification could not find generated bundles"
  );
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const controllerSource = readFileSync(
  resolve(projectRoot, "src/branches/branch-administration-controller.ts"),
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
  "branchesApi.createBranchAdministrationController({",
  "const branchAdministrationController =",
  "refreshBranches: () => activeBranchController.refresh(),",
  "branchAdministrationController.setup();",
  "refreshBranchSettings: () => branchAdministrationController.render(),"
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
  "PASS: Branch Administration remains a separate typed owner while Active Branch refresh delegates through its typed controller"
);
