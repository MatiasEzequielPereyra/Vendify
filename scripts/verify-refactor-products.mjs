import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Products verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyProductsV232",
  "createProductsController",
  "createScannerController",
  "mapProductRow",
  "productLabel",
  "listProducts",
  "listCategories",
  "saveProduct",
  "deleteProduct",
  "adjustInitialStock",
  "confirmScannedStock",
  "importCatalog",
  "listar_productos_sucursal_seguro_v1",
  "guardar_producto_seguro_v2",
  "confirmar_stock_por_scanner_v2",
  "producto-row-v223",
  "vendify_scanner_profile_v2"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Products marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyProductsV232.createController({",
  "window.VendifyProductsV232.createScannerController({",
  "productsControllerV232.loadProducts()",
  "productsControllerV232.render()",
  "productsControllerV232.openEditor(producto)",
  "scannerControllerV232.open(mode)",
  "productsControllerV232.applyRemoteChange(payload)",
  "captureOfflineStockSnapshot: async (items)",
  "window.VendifyOfflineV2312.captureStockSnapshot({",
  "productsControllerV232.setup()",
  "scannerControllerV232.setup()"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Products delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  '"listar_productos_sucursal_seguro_v1",',
  '"listar_categorias_seguras_v1"',
  '"inicializar_categorias_seguras_v1",',
  '"guardar_categoria_segura_v1",',
  '"eliminar_categoria_segura_v1",',
  '"guardar_producto_seguro_v2",',
  '"eliminar_producto_seguro_v1",',
  '"eliminar_todos_productos_seguro_v1"',
  '"ajustar_stock_inicial_rapido_v2",',
  '"obtener_stock_inteligente_sucursal",',
  '"confirmar_stock_por_scanner_v2",',
  '"importar_productos_seguro_v1",',
  "const CATALOGO_BASE_V29",
  "const PRODUCTOS_EJEMPLO",
  "let scannerModeV29",
  "let scannerReaderV29",
  "let scannerTrackVPro",
  "let stockInteligente",
  "let filtroStockBajo",
  "function filtrarYOrdenar",
  "function guardarProducto(",
  "function eliminarProducto(",
  "function cambiarStockEjecutarVQA",
  "function procesarCodigoV29",
  "function importarCatalogoV29",
  "function registrarExitoScannerVPro",
  "function iniciarDetectorNativoVPro"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Products logic: ${obsoleteMarker}`);
  }
}

if (runtime.includes("row-product-v29")) {
  throw new Error("Obsolete product row renderer was restored");
}

console.log("PASS: root and generated runtimes delegate Products and scanner to TypeScript");
