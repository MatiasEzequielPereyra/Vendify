import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260904_001_tenant_plan_limit_hardening.sql",
  import.meta.url
);

async function loadMigration() {
  return readFile(migrationUrl, "utf8");
}

test("plan limit validation checks tenant access before plan data", async () => {
  const sql = await loadMigration();
  const accessGuard = sql.indexOf("public.es_miembro_negocio(p_negocio_id)");
  const subscriptionRead = sql.indexOf("from public.vendify_suscripciones");

  assert.notEqual(accessGuard, -1);
  assert.notEqual(subscriptionRead, -1);
  assert.ok(accessGuard < subscriptionRead);
  assert.match(sql, /coalesce\(auth\.role\(\),''\) = 'service_role'/);
  assert.match(sql, /session_user in \('postgres','supabase_admin'\)/);
  assert.match(sql, /raise exception 'Acceso denegado'/);
});

test("plan limit primitive is not executable by API roles", async () => {
  const sql = await loadMigration();

  assert.match(
    sql,
    /revoke all on function public\.validar_limite_plan_v1\([\s\S]*?\) from public, anon, authenticated;/
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.validar_limite_plan_v1[\s\S]*?to authenticated;/
  );
  assert.match(sql, /has_function_privilege\([\s\S]*?'anon'/);
  assert.match(sql, /has_function_privilege\([\s\S]*?'authenticated'/);
});

test("plan limit validation rejects unknown resource names", async () => {
  const sql = await loadMigration();

  assert.match(
    sql,
    /p_recurso not in \('sucursales','usuarios','productos'\)/
  );
  assert.match(sql, /raise exception 'Recurso de plan inválido'/);
});
