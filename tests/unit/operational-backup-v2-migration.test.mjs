import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../../supabase/migrations/20260921130000_operational_backup_v2.sql", import.meta.url),
  "utf8"
).toLowerCase();

test("backup v2 keeps jobs and parts private", () => {
  assert.match(sql, /create table public\.operational_backups/);
  assert.match(sql, /create table public\.operational_backup_parts/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.operational_backups from public,anon,authenticated/);
  assert.match(sql, /revoke all on table public\.operational_backup_parts from public,anon,authenticated/);
  assert.match(sql, /cursor_secret text not null/);
});

test("backup v2 RPCs are owner-only security definer boundaries", () => {
  for (const name of [
    "iniciar_respaldo_operativo_v2",
    "exportar_pagina_respaldo_operativo_v2",
    "estado_respaldo_operativo_v2"
  ]) {
    const start = sql.indexOf(`function public.${name}`);
    assert.notEqual(start, -1);
    assert.match(sql.slice(start, start + 1800), /security definer[\s\S]*set search_path\s*=\s*''/);
  }
  assert.match(sql, /tiene_rol_negocio\(v_negocio_id,array\['owner'\]\)/);
  assert.match(sql, /from public\.operational_backups b[\s\S]*b\.negocio_id=v_negocio_id/);
  assert.match(sql, /revoke execute on function public\.exportar_pagina_respaldo_operativo_v2[\s\S]*from public,anon/);
});

test("backup pages use signed keyset cursors and bounded limits", () => {
  assert.match(sql, /p_limit < 100 or p_limit > 2000/);
  assert.match(sql, /extensions\.hmac\(v_payload,v_backup\.cursor_secret,'sha256'\)/);
  assert.match(sql, /v_cursor_backup<>p_backup_id or v_cursor_section<>v_section/);
  assert.match(sql, /t\.id>\$2/);
  assert.match(sql, /order by row_id limit \$4 \+ 1/);
  assert.doesNotMatch(sql, /\boffset\b/);
  for (const table of ["productos", "venta_items", "venta_pagos", "movimientos"]) {
    assert.match(sql, new RegExp(`create index [^;]+ on public\\.${table}\\(negocio_id,id\\)`));
  }
});

test("backup pages redact access codes, password material and product images", () => {
  assert.match(sql, /to_jsonb\(t\)-''codigo_acceso''/);
  assert.match(sql, /to_jsonb\(t\)-''pin_descuento_hash''/);
  assert.match(sql, /to_jsonb\(t\)-''foto''-''user_id''/);
});
