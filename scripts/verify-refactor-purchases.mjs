import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Purchases verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyPurchasesV232",
  "createPurchasesController",
  "listSuppliers",
  "saveSupplier",
  "listPurchases",
  "getPurchase",
  "savePurchaseDraft",
  "receivePurchase",
  "cancelPurchaseDraft",
  "listar_proveedores_v1",
  "guardar_proveedor_v1",
  "listar_compras_v1",
  "obtener_compra_v1",
  "guardar_compra_borrador_v1",
  "recibir_compra_v1",
  "anular_compra_borrador_v1"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Purchases marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyPurchasesV232.createController({",
  "purchasesControllerV232.refreshOpenViews()",
  "purchasesControllerV232.setup()",
  "listBranches: listarSucursalesV2",
  "reloadProducts: cargarProductos",
  "emitStockChange: emitirCambioStockRealtime"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Purchases delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  'supabaseClient.rpc("listar_proveedores_v1"',
  '"guardar_proveedor_v1",',
  '"listar_compras_v1",',
  '"obtener_compra_v1",',
  '"guardar_compra_borrador_v1",',
  '"recibir_compra_v1",',
  '"anular_compra_borrador_v1",',
  "let proveedoresV230",
  "let comprasV230",
  "let compraItemsV230",
  "let compraOperacionEnCursoV23011",
  "function abrirComprasV230",
  "function cargarProveedoresV230",
  "function cargarComprasV230",
  "function guardarCompraV230",
  "function setupComprasV230"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Purchases logic: ${obsoleteMarker}`);
  }
}

console.log("PASS: root and generated runtimes delegate Purchases to TypeScript");
