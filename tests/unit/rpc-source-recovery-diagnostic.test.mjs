import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const path = new URL("../../supabase/diagnostics/rpc_source_recovery.sql", import.meta.url);
test("RPC source recovery diagnostic is read-only and includes every missing contract", async () => {
 const sql=await readFile(path,"utf8");
 assert.match(sql,/^-- Read-only/m); assert.doesNotMatch(sql,/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i); assert.match(sql,/pg_get_functiondef/);
 for(const rpc of ["actualizar_rol_miembro_v2","actualizar_sucursal_v1","autorizar_descuento_v1","cambiar_estado_caja_v1","cambiar_estado_miembro_v3","configurar_pin_descuento_v1","crear_caja_v1","crear_sucursal_v1","diagnostico_integridad_v1","estado_pin_descuento_v1","listar_equipo_v3","listar_sucursales_admin_v1","obtener_negocio_admin_actual","obtener_perfil_empleado_actual"]) assert.match(sql,new RegExp(`'${rpc}'`));
});


