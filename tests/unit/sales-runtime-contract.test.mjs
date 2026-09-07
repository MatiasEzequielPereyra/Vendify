import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_004_sales_runtime_contract.sql"),
  "utf8"
);
const executeHardeningMigration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_005_sales_rpc_execute_hardening.sql"),
  "utf8"
);
const v3InternalMigration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_006_sales_v3_internal_only.sql"),
  "utf8"
);

test("sales runtime contract validates the exact v4 RPC signature", () => {
  assert.match(
    migration,
    /registrar_venta_v4\(jsonb,jsonb,text,numeric,text,uuid,uuid,text\)/
  );
  assert.match(migration, /No publicar el POS ni habilitar sincronización offline/);
});

test("sales runtime contract requires authenticated execution and atomic dependencies", () => {
  assert.match(migration, /has_function_privilege\([\s\S]*'authenticated'[\s\S]*'execute'/);
  for (const table of ["venta_pagos", "venta_items", "producto_stock_sucursal", "cajas_sesiones"]) {
    assert.match(migration, new RegExp(`to_regclass\\('public\\.${table}'\\)`));
  }
});

test("critical sales RPC cannot be invoked by anon", () => {
  assert.match(executeHardeningMigration, /revoke execute[\s\S]*from public/i);
  assert.match(executeHardeningMigration, /revoke execute[\s\S]*from anon/i);
  assert.match(executeHardeningMigration, /to authenticated, service_role/i);
  assert.match(exeuteHardeningMigration, /has_function_privilege\('anon',[\s\S]*'execute'\)/);
  assert.match(executeHardeningMigration, /has_function_privilege\('authenticated',[\s\S]*'execute'\)/);
});

test("only idempotent v4 remains callable by authenticated clients", () => {
  assert.match(v3InternalMigration, /v3\.proowner = v4\.proowner/);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from public/i);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from anon/i);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from authenticated/i);
  assert.match(v3InternalMigration, /registrar_venta_v3 sigue expuesta a clientes/);
});
