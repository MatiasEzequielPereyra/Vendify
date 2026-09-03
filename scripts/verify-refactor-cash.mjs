import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) throw new Error("Refactor Cash verification could not find generated bundles");

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");

for (const marker of [
  "VendifyCashV232",
  "createCashController",
  "listCashRegisters",
  "getCashState",
  "openCashRegister",
  "registerCashMovement",
  "listOpenCashMovements",
  "closeCashRegister",
  "listCashHistory",
  "createCashRegister",
  "setCashRegisterActive",
  "dependencies.setCashState(proof.estado)",
  "listar_cajas_sucursal_v1",
  "obtener_estado_caja_v1",
  "registrar_movimiento_caja_v1"
]) {
  if (!runtime.includes(marker)) throw new Error(`Modular runtime missing Cash marker: ${marker}`);
}

for (const marker of [
  "window.VendifyCashV232.createController({",
  "cashControllerV232.loadRegisters({ keep: mantener })",
  "cashControllerV232.selectRegister(e.target.value)",
  "cashControllerV232.loadState()",
  "cashControllerV232.isOpenByCurrentUser()",
  "cashControllerV232.getState()",
  "setCashState: (state) => cashControllerV232.setState(state)",
  "cashControllerV232.renderOptions()",
  "cashControllerV232.setup()"
]) {
  if (!app.includes(marker) || !sourceApp.includes(marker)) {
    throw new Error(`Compatibility app missing Cash delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  "let cajasSucursalV227",
  "let cajaEstadoV227",
  "let cajaMovimientosV227",
  "let cashMovementTypeV227",
  "let cajaOperacionEnCursoV23011",
  'supabaseClient.rpc("listar_cajas_sucursal_v1"',
  'supabaseClient.rpc("obtener_estado_caja_v1"',
  'supabaseClient.rpc("abrir_caja_v1"',
  'supabaseClient.rpc("registrar_movimiento_caja_v1"',
  'supabaseClient.rpc("listar_movimientos_caja_abierta_v1"',
  'supabaseClient.rpc("cerrar_caja_v1"',
  'supabaseClient.rpc("listar_historial_cajas_v1"',
  'supabaseClient.rpc("crear_caja_v1"',
  'supabaseClient.rpc("cambiar_estado_caja_v1"',
  "function abrirMovimientoCajaV227",
  "function guardarMovimientoCajaV227",
  "function cerrarCajaV227",
  "function renderHistorialCajaV227"
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Cash logic: ${obsoleteMarker}`);
  }
}

console.log("PASS: root and generated runtimes delegate Cash to TypeScript");
