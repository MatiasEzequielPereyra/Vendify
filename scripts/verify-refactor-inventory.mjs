import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Inventory verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyInventoryV232",
  "createInventoryController",
  "createBranchTransferController",
  "listInventoryMovements",
  "adjustInventoryStock",
  "applyPhysicalCount",
  "listTransferProducts",
  "transferInventoryStock",
  "listar_movimientos_inventario_v1",
  "ajustar_stock_inventario_v2",
  "aplicar_conteo_fisico_v2",
  "listar_productos_sucursal_seguro_v1",
  "transferir_stock_v2"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Inventory marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyInventoryV232.createController({",
  "window.VendifyInventoryV232.createBranchTransferController({",
  "window.VendifyInventoryV232.adjustStock(",
  "inventoryControllerV232.refreshOpenView(false)",
  "inventoryControllerV232.refreshOpenView()",
  "inventoryControllerV232.openAdjustmentFromProduct(id, delta)",
  "inventoryControllerV232.setup()",
  "branchTransferControllerV232.setup()",
  "listBranches: listarSucursalesV2",
  "reloadProducts: cargarProductos",
  "emitStockChange: emitirCambioStockRealtime"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Inventory delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  '"listar_movimientos_inventario_v1",',
  '"ajustar_stock_inventario_v2",',
  '"aplicar_conteo_fisico_v2",',
  '"transferir_stock_v2",',
  '"listar_productos_sucursal_v1",',
  '"transferir_stock_v1",',
  "let inventoryMovements",
  "let inventoryCountDraft",
  "let inventoryTransferProducts",
  "let inventoryActiveTab",
  "let conteoOperacionEnCursoV23011",
  "let transferenciaOperacionEnCursoV23011",
  "let productosTransferV226",
  "function abrirInventario",
  "function refrescarInventarioProfesional",
  "function renderResumenInventario",
  "function cargarMovimientosInventario",
  "function aplicarAjusteInventario",
  "function aplicarConteoFisico",
  "function transferirStockInventario",
  "function setupInventarioProfesional",
  "function abrirTransferenciaV226",
  "function cerrarTransferenciaV226",
  "function cargarProductosTransferV226",
  "function actualizarDisponibleTransferV226",
  "function transferirStockV226"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Inventory logic: ${obsoleteMarker}`);
  }
}

console.log("PASS: root and generated runtimes delegate Inventory to TypeScript");
