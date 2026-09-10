import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL(
  "../../supabase/sources/recovered_rpc_definitions_20260910.sql",
  import.meta.url
);

const recoveredRpcs = [
  "actualizar_rol_miembro_v2",
  "actualizar_sucursal_v1",
  "autorizar_descuento_v1",
  "cambiar_estado_caja_v1",
  "cambiar_estado_miembro_v3",
  "configurar_pin_descuento_v1",
  "crear_caja_v1",
  "crear_sucursal_v1",
  "diagnostico_integridad_v1",
  "estado_pin_descuento_v1",
  "listar_equipo_v3",
  "listar_sucursales_admin_v1",
  "obtener_negocio_admin_actual",
  "obtener_perfil_empleado_actual"
];

const roleGuardedRpcs = [
  "actualizar_rol_miembro_v2",
  "actualizar_sucursal_v1",
  "cambiar_estado_caja_v1",
  "cambiar_estado_miembro_v3",
  "crear_caja_v1",
  "crear_sucursal_v1",
  "diagnostico_integridad_v1",
  "listar_equipo_v3",
  "listar_sucursales_admin_v1"
];

function functionBody(sql, name) {
  const start = sql.search(
    new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b`, "i")
  );
  assert.notEqual(start, -1, `${name} must be present in the recovered source`);
  const openingDelimiter = sql.indexOf("$function$", start);
  assert.notEqual(openingDelimiter, -1, `${name} must declare a function body`);
  const end = sql.indexOf("$function$", openingDelimiter + "$function$".length);
  assert.notEqual(end, -1, `${name} must have a terminated function body`);
  return sql.slice(start, end + "$function$".length);
}

test("recovered SECURITY DEFINER RPCs pin their search path", async () => {
  const sql = await readFile(sourcePath, "utf8");

  for (const rpc of recoveredRpcs) {
    const body = functionBody(sql, rpc);
    assert.match(body, /security\s+definer/i, `${rpc} must remain SECURITY DEFINER`);
    assert.match(body, /set\s+search_path\s+to\s+'public'/i, `${rpc} must pin public search_path`);
  }
});

test("recovered privileged RPCs establish the tenant before authorizing", async () => {
  const sql = await readFile(sourcePath, "utf8");

  for (const rpc of roleGuardedRpcs) {
    const body = functionBody(sql, rpc);
    assert.match(body, /negocio_actual_id\s*\(\s*\)/i, `${rpc} must resolve the current tenant`);
    assert.match(body, /tiene_rol_negocio\s*\(/i, `${rpc} must enforce a server-side role`);
  }
});

test("employee and admin profile reads derive identity from auth.uid", async () => {
  const sql = await readFile(sourcePath, "utf8");

  for (const rpc of ["obtener_negocio_admin_actual", "obtener_perfil_empleado_actual"]) {
    assert.match(functionBody(sql, rpc), /auth\.uid\s*\(\s*\)/i);
  }
});
