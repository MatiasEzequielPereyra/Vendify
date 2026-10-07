import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^vendify-app-v232-[0-9a-f]{12}\.js$/.test(file));
if (!runtimeFile || !appFile) throw new Error("Refactor Sales verification could not find generated bundles");

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "src/bootstrap/application-composition.ts"), "utf8");

for (const marker of [
  "VendifySalesV232", "createDiscountController", "createPosController", "createSalesHistoryController",
  "registerSale", "authorizeDiscount", "configureDiscountPin", "voidSale", "returnSaleItems", "listSales",
  "registrar_venta_v4", "autorizar_descuento_v1", "anular_venta_v1", "devolver_venta_v1",
  "pendiente_sincronizacion"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Sales marker: ${marker}`);
}

for (const marker of [
  "salesApi.createDiscountController({",
  "salesApi.createHistoryController({",
  "salesApi.createPosController({",
  "posController.getCart()",
  "posController.ensureRequestId()",
  "offlineController.registerSale(items, payments, totals, observation)",
  "discountController.setup()",
  "posController.setup()",
  "salesHistoryController.setup()"
]) {
  if (!sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Sales delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  "let carrito =", "let descuentoAutorizacion", "let pagoModoV228", "let historialVentasV228",
  "let ticketActualV228", "let gestionVentaV228", "let ventaRequestIdV23011", "let ventaConfirmandoV23011",
  'supabaseClient.rpc("registrar_venta_v4"', 'supabaseClient.rpc("autorizar_descuento_v1"',
  'supabaseClient.rpc("configurar_pin_descuento_v1"', 'supabaseClient.rpc("anular_venta_v1"',
  'supabaseClient.rpc("devolver_venta_v1"', '.from("ventas")',
  "function confirmarVenta", "function construirTicketHTMLV228", "function guardarGestionVentaV228",
  "function solicitudDescuentoActual", "function pagosMixtosDesdeDOMV228", "function rangoFechas"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Sales logic: ${obsoleteMarker}`);
  }
}

for (const offlineMarker of [
  "registrarVentaOfflineV2311", "asegurarVentaRequestIdV23011", "validarPagosOfflineV2311",
  "offlineController"
]) {
  if (!app.includes(offlineMarker)) throw new Error(`Sales refactor broke offline compatibility marker: ${offlineMarker}`);
}

console.log("PASS: root and generated runtimes delegate Sales/POS to TypeScript without changing offline routing");
