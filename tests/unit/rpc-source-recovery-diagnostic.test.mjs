import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const path = new URL("../../supabase/diagnostics/rpc_source_recovery.sql", import.meta.url);
test("RPC source recovery diagnostic is read-only and includes every missing contract", async () => {
 const sql=await readFile(path,"utf8");
 assert.match(sql,/^-- Read-only/m); assert.doesNotMatch(sql,/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i); assert.match(sql,/pg_get_functiondef/);
 for(const rpc of ["actualizar_rol_miembro_v2","actualizar_sucursal_v1","autorizar_descuento_v1","cambiar_estado_caja_v1","cambiar_estado_miembro_v3","configurar_pin_descuento_v1","crear_caja_v1","crear_sucursal_v1","diagnostico_integridad_v1","estado_pin_descuento_v1","listar_equipo_v3","listar_sucursales_admin_v1","obtener_negocio_admin_actual","obtener_perfil_empleado_actual"]) assert.match(sql,new RegExp(`'${rpc}'`));
});


const recoveredSourcePath = new URL(
  "../../supabase/sources/recovered_rpc_definitions_20260910.sql",
  import.meta.url
);
const coveragePath = new URL("../../contracts/rpc-source-coverage.json", import.meta.url);
const recoveredRpcNames = [
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

test("recovered RPC definitions close the source coverage gap without entering migrations", async () => {
  const [source, coverage] = await Promise.all([
    readFile(recoveredSourcePath, "utf8"),
    readFile(coveragePath, "utf8").then(JSON.parse)
  ]);
  assert.match(source, /Source reference only: do not include this file in the migration execution chain/i);
  assert.equal(coverage.missingCount, 0);
  for (const rpc of recoveredRpcNames) {
    assert.match(source, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${rpc}\\b`, "i"));
    const row = coverage.rows.find((entry) => entry.rpc === rpc);
    assert.deepEqual(row?.files, ["supabase/sources/recovered_rpc_definitions_20260910.sql"]);
  }
});
