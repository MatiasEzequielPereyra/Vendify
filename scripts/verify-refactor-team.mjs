import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const root = resolve(projectRoot, "dist-refactor-modular");
const files = readdirSync(root);
const runtimeFile = files.find((file) => /^vendify-core-v232-[0-9a-f]{12}\.js$/.test(file));
const appFile = files.find((file) => /^app-refactor-v232-[0-9a-f]{12}\.js$/.test(file));

if (!runtimeFile || !appFile) {
  throw new Error("Refactor Team verification could not find generated bundles");
}

const runtime = readFileSync(resolve(root, runtimeFile), "utf8");
const app = readFileSync(resolve(root, appFile), "utf8");
const sourceApp = readFileSync(resolve(projectRoot, "app.js"), "utf8");
const buildSource = readFileSync(
  resolve(projectRoot, "scripts/build-refactor-modular.mjs"),
  "utf8"
);

for (const marker of [
  "VendifyTeamV232",
  "getAdminBusiness",
  "listTeam",
  "updateStockPermission",
  "updateMemberRole",
  "setMemberActive",
  "createEmployee",
  "updateEmployee",
  "deleteEmployee",
  "resetEmployeePassword"
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
  "window.VendifyTeamV232.setMemberActive(",
  "window.VendifyTeamV232.createEmployee(",
  "window.VendifyTeamV232.updateEmployee(",
  "window.VendifyTeamV232.deleteEmployee(",
  "window.VendifyTeamV232.resetEmployeePassword("
]) {
  if (!app.includes(marker)) {
    throw new Error(`Compatibility app missing Team delegation: ${marker}`);
  }
  if (!sourceApp.includes(marker)) {
    throw new Error(`Root app.js missing Team delegation: ${marker}`);
  }
}

for (const obsoleteMarker of [
  'supabaseClient.rpc("obtener_negocio_admin_actual")',
  'supabaseClient.rpc("listar_equipo_v3")',
  'supabaseClient.rpc("listar_permisos_stock_equipo_v1")',
  '"actualizar_permiso_stock_miembro_v1"',
  'supabaseClient.rpc("actualizar_rol_miembro_v2"',
  'supabaseClient.rpc("cambiar_estado_miembro_v3"',
  'supabaseClient.functions.invoke("crear-empleado"',
  'supabaseClient.functions.invoke("gestionar-empleado"'
]) {
  if (app.includes(obsoleteMarker) || sourceApp.includes(obsoleteMarker)) {
    throw new Error(`Legacy app still contains migrated Team data access: ${obsoleteMarker}`);
  }
}

if (
  buildSource.includes("patchTeamRefactor") ||
  buildSource.includes("patch-refactor-team.mjs")
) {
  throw new Error("Modular build still depends on the removed Team regex patcher");
}

if (existsSync(resolve(projectRoot, "scripts/patch-refactor-team.mjs"))) {
  throw new Error("Removed Team regex patcher still exists");
}

console.log("PASS: root and generated runtimes delegate Team without regex-patched duplicate logic");
