import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20261005192108_team_manager_delegation_audit.sql"),
  "utf8"
);

test("VEN-015 grants manager Team context without broadening unrelated manager permissions", () => {
  const managerCase = migration.match(
    /when 'manager' then jsonb_build_object\(([\s\S]*?)\n\s*\)/
  )?.[1] ?? "";
  assert.match(managerCase, /'manageEmployees', true/);
  assert.match(managerCase, /'manageBusiness', false/);
  assert.match(migration, /nm\.rol in \('owner','admin','manager'\)/);
  assert.match(migration, /array\['owner','admin','manager'\]/);
});

test("VEN-015 preserves owner-only stock permission writes while allowing manager reads", () => {
  const stockRead = migration.slice(
    migration.indexOf("function public.listar_permisos_stock_equipo_v1"),
    migration.indexOf("function public.actualizar_permiso_stock_miembro_v1")
  );
  const stockWrite = migration.slice(
    migration.indexOf("function public.actualizar_permiso_stock_miembro_v1")
  );
  assert.match(stockRead, /array\['owner','admin','manager'\]/);
  assert.match(stockWrite, /array\['owner'\]/);
  assert.match(stockWrite, /'permiso_stock_actualizado'/);
});

test("VEN-015 role changes enforce manager hierarchy and audit old/new values", () => {
  const block = migration.slice(
    migration.indexOf("function public.actualizar_rol_miembro_v2"),
    migration.indexOf("function public.cambiar_estado_miembro_v3")
  );
  assert.match(block, /v_actor\.rol = 'manager'/);
  assert.match(block, /v_target\.rol not in \('manager','cashier'\)/);
  assert.match(block, /p_rol not in \('manager','cashier'\)/);
  assert.match(block, /v_target\.user_id = auth\.uid\(\)/);
  assert.match(block, /'rol_actualizado'/);
  assert.match(block, /'actor_role', v_actor\.rol/);
  assert.match(block, /'target_user_id', v_target\.user_id/);
  assert.match(block, /'rol_anterior', v_target\.rol/);
  assert.match(block, /'rol_nuevo', p_rol/);
});

test("VEN-015 active-state mutation is audited in the same database function", () => {
  const block = migration.slice(
    migration.indexOf("function public.cambiar_estado_miembro_v3"),
    migration.indexOf("function public.listar_permisos_stock_equipo_v1")
  );
  const mutation = block.indexOf("update public.negocio_miembros");
  const audit = block.indexOf("insert into public.audit_log");
  assert.ok(mutation >= 0 && audit > mutation);
  assert.match(block, /'estado_empleado_actualizado'/);
  assert.match(block, /'actor_role', v_actor\.rol/);
  assert.match(block, /'target_user_id', v_target\.user_id/);
  assert.match(block, /'target_role', v_target\.rol/);
  assert.match(block, /'activo_anterior', v_target\.activo/);
  assert.match(block, /'activo_nuevo', p_activo/);
});

test("VEN-015 keeps Team RPC execution away from anon", () => {
  for (const signature of [
    "public.obtener_contexto_app()",
    "public.obtener_negocio_admin_actual()",
    "public.listar_equipo_v3()",
    "public.actualizar_rol_miembro_v2(uuid,text)",
    "public.cambiar_estado_miembro_v3(uuid,boolean)",
    "public.listar_permisos_stock_equipo_v1()",
    "public.actualizar_permiso_stock_miembro_v1(uuid,boolean)"
  ]) {
    assert.match(migration, new RegExp(
      "revoke all on function " +
      signature.replace(/[()]/g, "\\$&") +
      " from public, anon;"
    ));
  }
});
