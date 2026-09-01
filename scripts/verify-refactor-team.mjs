import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Team verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");

for (const marker of [
  "VendifyTeamV232",
  "getAdminBusiness",
  "listTeam",
  "updateStockPermission",
  "updateMemberRole",
  "setMemberActive"
]) {
  if (!runtime.includes(marker)) {
    throw new Error(`Modular runtime missing Team marker: ${marker}`);
  }
}

for (const marker of [
  "window.VendifyTeamV232.getAdminBusiness(supabaseClient)",
  "window.VendifyTeamV232.listTeam(supabaseClient)",
  "window.VendifyTeamV232.updateStockPermission(",
  "window.VendifyTeamV232.updateMemberRole(",
  "window.VendifyTeamV232.setMemberActive("
]) {
  if (!app.includes(marker)) {
    throw new Error(`Compatibility app missing Team delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  'supabaseClient.rpc("obtener_negocio_admin_actual")',
  'supabaseClient.rpc("listar_equipo_v3")',
  'supabaseClient.rpc("listar_permisos_stock_equipo_v1")',
  '"actualizar_permiso_stock_miembro_v1"',
  'supabaseClient.rpc("actualizar_rol_miembro_v2"',
  'supabaseClient.rpc("cambiar_estado_miembro_v3"'
]) {
  if (app.includes(obsoleteMarker)) {
    throw new Error(`Compatibility app still contains migrated Team data access: ${obsoleteMarker}`);
  }
}

console.log("PASS: generated refactor runtime delegates first Team data slice");
