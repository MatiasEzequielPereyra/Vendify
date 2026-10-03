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
const sourceController = readFileSync(resolve(projectRoot, "src/products/products-controller.ts"), "utf8");
const sourceModel = readFileSync(resolve(projectRoot, "src/products/product-model.ts"), "utf8");
const sourceService = readFileSync(resolve(projectRoot, "src/products/products-service.ts"), "utf8");
const sourceProductHtml = readFileSync(resolve(projectRoot, "html/03-product-stock-modals.html"), "utf8");
const generatedProductHtml = readFileSync(resolve(root, "html/03-product-stock-modals.html"), "utf8");

for (const marker of [
  "VendifyProductsV232",
  "createProductsController",
  "createProductsStore",
  "createScannerController",
  "renderSaleProductsHtml",
  "serializeProductCatalogCache",
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
  "window.VendifyProductsV232.createStore()",
  "window.VendifyProductsV232.createScannerController({",
  "productsControllerV232.loadProducts()",
  "productsControllerV232.render()",
  "productsControllerV232.openEditor(producto)",
  "lookupBarcode: (code) => productsControllerV232.lookupBarcode(code)",
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
  "let productos =",
  "let categorias =",
  "getProducts: () => productos",
  "setProducts:",
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


const retiredProductMediaAppMarkers = [
  "fotoActualBase64",
  "cropImage",
  "cropScale",
  "cropBaseScale",
  "cropOffsetX",
  "cropOffsetY",
  "cropDragging",
  "cropLastX",
  "cropLastY",
  "leerArchivoImagen",
  "abrirEditorRecorte",
  "resetearCrop",
  "cerrarEditorRecorte",
  "renderCropCanvas",
  "aplicarRecorteFoto",
  "puntoCropDesdeEvento",
  "iniciarDragCrop",
  "moverDragCrop",
  "terminarDragCrop",
  "mostrarPreviewFoto",
  "manejarFoto"
];

for (const [label, source] of [
  ["source app", sourceApp],
  ["generated compatibility app", app]
]) {
  for (const marker of retiredProductMediaAppMarkers) {
    if (source.includes(marker)) {
      throw new Error(`Retired Product media marker restored in ${label}: ${marker}`);
    }
  }
}

if (sourceController.includes("setCurrentPhoto")) {
  throw new Error("Products controller restored dead setCurrentPhoto dependency");
}

const retiredProductMediaIds = [
  "foto-input",
  "foto-camara",
  "foto-preview",
  "foto-placeholder",
  "foto-img",
  "btn-quitar-foto",
  "crop-zoom",
  "crop-canvas",
  "btn-crop-reset",
  "btn-aplicar-crop",
  "btn-cancelar-crop",
  "btn-cerrar-crop",
  "modal-crop-foto"
];

for (const [label, source] of [
  ["source Product HTML", sourceProductHtml],
  ["generated Product HTML", generatedProductHtml]
]) {
  for (const id of retiredProductMediaIds) {
    if (source.includes(`id="${id}"`)) {
      throw new Error(`Retired Product media control restored in ${label}: ${id}`);
    }
  }
}


const retiredLegacyStockAppMarkers = [
  "stockAjusteId",
  "stockAjusteValor",
  "abrirModalStock",
  "cerrarModalStock",
  "aplicarDeltaStock",
  "confirmarAjusteStock",
  "window.VendifyInventoryV232.adjustStock("
];

for (const [label, source] of [
  ["source app", sourceApp],
  ["generated compatibility app", app]
]) {
  for (const marker of retiredLegacyStockAppMarkers) {
    if (source.includes(marker)) {
      throw new Error(`Retired legacy stock modal marker restored in ${label}: ${marker}`);
    }
  }
}

if (sourceController.includes("openManualStockModal")) {
  throw new Error("Products controller restored retired openManualStockModal dependency");
}

for (const marker of [
  "readonly openInventoryAdjustment: (productId: string, delta?: number | null) => void;",
  "dependencies.openInventoryAdjustment(productId);",
  "dependencies.openInventoryAdjustment(productId, delta);"
]) {
  if (!sourceController.includes(marker)) {
    throw new Error(`Products controller lost typed Inventory adjustment delegation: ${marker}`);
  }
}

const retiredLegacyStockIds = [
  "modal-stock",
  "btn-cerrar-stock",
  "btn-stock-cancel",
  "btn-stock-ok",
  "stock-nombre",
  "stock-actual",
  "stock-manual",
  "stock-motivo",
  "stock-nota"
];

for (const [label, source] of [
  ["source Product HTML", sourceProductHtml],
  ["generated Product HTML", generatedProductHtml]
]) {
  for (const id of retiredLegacyStockIds) {
    if (source.includes(`id="${id}"`)) {
      throw new Error(`Retired legacy stock modal control restored in ${label}: ${id}`);
    }
  }
  if (source.includes("btn-stock-big")) {
    throw new Error(`Retired legacy stock modal quick-control class restored in ${label}`);
  }
}

for (const marker of [
  "foto: string | null",
  "foto: text(row.foto) || null"
]) {
  if (!sourceModel.includes(marker)) {
    throw new Error(`Product model lost existing-photo compatibility: ${marker}`);
  }
}

for (const marker of [
  "product.foto",
  "producto-v223-img",
  "producto-v223-icon"
]) {
  if (!sourceController.includes(marker)) {
    throw new Error(`Products renderer lost photo/fallback compatibility: ${marker}`);
  }
}

if (sourceService.includes("p_foto")) {
  throw new Error("Product save contract unexpectedly gained p_foto");
}

if (runtime.includes("row-product-v29")) {
  throw new Error("Obsolete product row renderer was restored");
}

console.log("PASS: root and generated runtimes delegate Products and scanner to TypeScript");
