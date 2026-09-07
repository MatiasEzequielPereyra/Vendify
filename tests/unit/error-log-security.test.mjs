import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_001_error_log_hardening.sql"),
  "utf8"
);

test("error logging resolves membership before using the tenant rate limit", () => {
  const membershipGuard = migration.indexOf("public.es_miembro_negocio(v_negocio_id) is not true");
  const lock = migration.indexOf("pg_advisory_xact_lock");
  const count = migration.indexOf("v_eventos_recientes >= 30");

  assert.ok(membershipGuard >= 0, "the member guard must remain present");
  assert.ok(lock > membershipGuard, "the advisory lock must run after membership validation");
  assert.ok(count > lock, "the rate limit must execute while the tenant lock is held");
  assert.match(migration, /e\.negocio_id = v_negocio_id[\s\S]*e\.user_id = auth\.uid\(\)[\s\S]*interval '1 minute'/);
});

test("error logging only stores branches owned by the authenticated business", () => {
  assert.match(
    migration,
    /from public\.sucursales s[\s\S]*s\.id = v_sucursal_solicitada[\s\S]*s\.negocio_id = v_negocio_id/
  );
  assert.match(migration, /v_contexto := coalesce\(p_contexto, '\{\}'::jsonb\) - 'branch_id'/);
  assert.match(migration, /if v_sucursal_id is not null then[\s\S]*jsonb_build_object\('branch_id', v_sucursal_id::text\)/);
});

test("error logging stays unavailable to anonymous clients", () => {
  assert.match(migration, /revoke all on function public\.registrar_error_cliente_v1[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.registrar_error_cliente_v1[\s\S]*to authenticated/);
  assert.match(migration, /registrar_error_cliente_v1 continúa expuesta a anon/);
});
