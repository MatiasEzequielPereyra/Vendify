import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(
    currentDirectory,
    "../../supabase/migrations/20260909_011_critical_table_grants_hardening.sql"
  ),
  "utf8"
);

test("critical tables deny direct anon access while preserving known frontend reads", () => {
  assert.match(migration, /revoke all on table public.%I from public, anon/i);
  assert.match(migration, /grant all on table public.%I to service_role/i);
  assert.match(migration, /grant select on table public.%I to authenticated/i);
  assert.match(migration, /v_anon_exposed is not null/);

  for (const table of [
    "producto_stock_sucursal",
    "ventas",
    "venta_items",
    "venta_pagos",
    "venta_devoluciones"
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
});
