import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const app = readFileSync(resolve(root, "app.js"), "utf8");
const html = readdirSync(resolve(root, "html"))
  .filter((file) => file.endsWith(".html"))
  .map((file) => readFileSync(resolve(root, "html", file), "utf8"))
  .join("\n");

const removedLegacySymbols = [
  "registrarVentaV2",
  "ajustarStockV2",
  "aplicarCambioRemoto",
  "nombreCompletoProducto",
  "comprimirImagen",
  "renderSelectCategorias",
  "calcularTotalesVentaV228",
  "actualizarTotalesVentaV228",
  "cambiarCantidadCarrito",
  "quitarDelCarrito",
  "calcularTotalCarrito",
  "mostrarTicketV228",
  "abrirHistorial",
  "buscarDatosBarcodeV29",
  "abrirScannerV29",
  "cerrarScannerV29",
  "renderEstadoCajaHeaderV227",
  "abrirConfigSucursalesV226",
  "abrirTransferenciaV226",
  "cerrarTransferenciaV226",
  "cargarProductosTransferV226",
  "actualizarDisponibleTransferV226",
  "transferirStockV226",
  "cerrarConfirm"
];

for (const symbol of removedLegacySymbols) {
  const declaration = new RegExp(`\\b(?:async\\s+)?function\\s+${symbol}\\s*\\(`);
  if (declaration.test(app)) {
    throw new Error(`Removed legacy function was restored: ${symbol}`);
  }
  if (new RegExp(`\\b${symbol}\\b`).test(html)) {
    throw new Error(`HTML still references removed legacy function: ${symbol}`);
  }
}

if (/\bMAX_IMG_SIZE\b/.test(app)) {
  throw new Error("Unused legacy image compression constant was restored: MAX_IMG_SIZE");
}

if (/\bconfirmCallback\b/.test(app)) {
  throw new Error("Obsolete confirmation callback state was restored");
}

console.log(`PASS: ${removedLegacySymbols.length} unreferenced legacy functions remain removed`);
