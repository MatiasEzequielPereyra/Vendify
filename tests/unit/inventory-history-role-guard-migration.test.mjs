import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const file = "supabase/migrations/20261014170534_inventory_history_role_guard.sql";
const migration = readFileSync(resolve(root, file), "utf8");
const historical = readFileSync(resolve(root, "supabase/legacy/modules/inventario_profesional.sql"), "utf8");
const original = historical.slice(historical.indexOf("create or replace function public.listar_movimientos_inventario_v1("));
const selectBlock = (sql) => sql.slice(sql.indexOf("    return query"), sql.indexOf("end;", sql.indexOf("    return query"))).replaceAll("\r\n", "\n");

test("history authorization correction preserves the complete authorized return query", () => {
  assert.equal(selectBlock(migration), selectBlock(original));
  assert.equal(migration.slice(migration.indexOf("create or replace"), migration.indexOf("as $$")).replaceAll("\r\n", "\n"),
    original.slice(0, original.indexOf("as $$")).replaceAll("\r\n", "\n"));
});
test("history guard denies non-supervisors before reading any history", () => {
  const guard = migration.indexOf("public.tiene_rol_negocio(v_negocio_id, array['owner','admin','manager'])");
  assert.ok(guard > migration.indexOf("public.es_miembro_negocio"));
  assert.ok(guard < migration.indexOf("    return query"));
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.doesNotMatch(migration, /(?:create|alter|drop)\s+policy|disable\s+row\s+level\s+security/i);
});
test("forward migration is registered and keeps anonymous execution revoked", () => {
  const readiness = JSON.parse(readFileSync(resolve(root, "contracts/commercial-readiness.json"), "utf8"));
  assert.equal(readiness.migrationChain.files.at(-1), file);
  assert.match(migration, /revoke all on function public\.listar_movimientos_inventario_v1\(uuid,integer\) from public, anon/);
  assert.match(migration, /grant execute on function public\.listar_movimientos_inventario_v1\(uuid,integer\) to authenticated/);
});
