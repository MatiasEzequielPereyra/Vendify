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
    "Refactor Active Branch verification could not find generated bundles"
  );
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");
const controllerSource = readFileSync(
  resolve(projectRoot, "src/branches/active-branch-controller.ts"),
  "utf8"
);
const bridgeSource = readFileSync(
  resolve(projectRoot, "src/legacy/branches-bridge.ts"),
  "utf8"
);

for (const marker of [
  "VendifyBranchesV232",
  "createActiveBranchController",
  "createBranchAdministrationController"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Active Branch marker: ${marker}`);
  }
}

if (!bridgeSource.includes("createActiveBranchController")) {
  throw new Error("Branches bridge does not expose createActiveBranchController");
}

for (const marker of [
  "const activeBranchController =",
  "branchesApi.createActiveBranchController({",
  "getBranches: () => activeBranchController.getBranches(),",
  "selectBranch: (id) => activeBranchController.select(id),",
  "refreshBranches: () => activeBranchController.refresh(),",
  "await activeBranchController.initialize();",
  "activeBranchController.setup();",
  "branchTransferController.setup();",
  "branchAdministrationController.setup();"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(`Root app.js missing Active Branch composition: ${marker}`);
  }
  if (!app.includes(marker)) {
    throw new Error(`Generated app missing Active Branch composition: ${marker}`);
  }
}

for (const legacyMarker of [
  "async function listarSucursalesV2",
  "async function cambiarSucursalV2",
  "async function inicializarSucursalActivaV226",
  "function renderSelectorSucursalesV226",
  "async function cambiarSucursalDesdeSelectorV226",
  "async function refrescarSucursalesV226",
  "function setupSucursalesV226",
  "sucursalesV226"
]) {
  if (sourceApp.includes(legacyMarker) || app.includes(legacyMarker)) {
    throw new Error(`Legacy Active Branch marker still present: ${legacyMarker}`);
  }
}

for (const forbiddenAppMarker of [
  "VendifyContextV232.listBranches",
  "VendifyContextV232.getBranch",
  "#branch-selector-v226"
]) {
  if (sourceApp.includes(forbiddenAppMarker)) {
    throw new Error(
      `Root app.js still owns Active Branch backend/selector detail: ${forbiddenAppMarker}`
    );
  }
}

for (const serviceMarker of [
  'from "../context/context-service.js"',
  "listAppBranches",
  "getBranchContext"
]) {
  if (!controllerSource.includes(serviceMarker)) {
    throw new Error(
      `Typed Active Branch owner missing Context service usage: ${serviceMarker}`
    );
  }
}

for (const forbiddenControllerMarker of [
  ".rpc(",
  "window.Vendify",
  "posController",
  "cashController",
  "contextPickerController",
  "realtimeController",
  "cargarProductos",
  "renderGrid",
  "appContext"
]) {
  if (controllerSource.includes(forbiddenControllerMarker)) {
    throw new Error(
      `Typed Active Branch owner leaked external ownership: ${forbiddenControllerMarker}`
    );
  }
}

for (const separationMarker of [
  "branchesApi.createBranchAdministrationController({",
  "inventoryApi.createBranchTransferController({",
  "cashApi.createController({"
]) {
  if (!sourceApp.includes(separationMarker)) {
    throw new Error(
      `Active Branch extraction lost separate owner composition: ${separationMarker}`
    );
  }
}

console.log(
  "PASS: root and generated runtimes delegate Active Branch lifecycle ownership to TypeScript without absorbing Cash, Branch Administration, Branch Transfer, Products, Offline or Realtime"
);
