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
const stockLockMigration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260907_007_sales_stock_lock_order.sql"),
  "utf8"
);
const idempotencyIntegrityMigration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260908_008_sales_idempotency_payload_integrity.sql"),
  "utf8"
);
const accessReassertionMigration = fs.readFileSync(
  path.resolve(currentDirectory, "../../supabase/migrations/20260908_009_sales_rpc_access_reassertion.sql"),
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
  assert.match(executeHardeningMigration, /has_function_privilege\('anon',[\s\S]*'execute'\)/);
  assert.match(executeHardeningMigration, /has_function_privilege\('authenticated',[\s\S]*'execute'\)/);
});

test("only idempotent v4 remains callable by authenticated clients", () => {
  assert.match(v3InternalMigration, /v3\.proowner = v4\.proowner/);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from public/i);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from anon/i);
  assert.match(v3InternalMigration, /revoke all[\s\S]*from authenticated/i);
  assert.match(v3InternalMigration, /registrar_venta_v3 sigue expuesta a clientes/);
});

test("concurrent sales take product locks in deterministic order before v3", () => {
  assert.match(stockLockMigration, /select distinct \(item->>'producto_id'\)::uuid/);
  assert.match(stockLockMigration, /order by 1/);
  assert.match(stockLockMigration, /pg_advisory_xact_lock/);
  assert.match(stockLockMigration, /hashtextextended\(v_lock_producto_id::text, 0\)/);
  assert.match(stockLockMigration, /v_respuesta := public\.registrar_venta_v3/);
  assert.match(stockLockMigration, /on conflict \(negocio_id, user_id, request_id\) do nothing/);
});

test("an idempotency key cannot be reused with a different sale payload", () => {
  assert.match(idempotencyIntegrityMigration, /add column if not exists payload_hash text/i);
  assert.match(idempotencyIntegrityMigration, /create extension if not exists pgcrypto/i);
  assert.match(idempotencyIntegrityMigration, /from pg_extension e/);
  assert.match(idempotencyIntegrityMigration, /%1\$I\.digest\([\s\S]*'sha256'/);
  assert.match(idempotencyIntegrityMigration, /negocio_id, user_id, request_id, payload_hash/);
  assert.match(idempotencyIntegrityMigration, /select vi\.respuesta, vi\.payload_hash/);
  assert.match(idempotencyIntegrityMigration, /v_payload_hash_existente <> v_payload_hash/);
  assert.match(idempotencyIntegrityMigration, /ya fue usado con una venta distinta/);
});

test("only v4 remains callable by API roles after access reassertion", () => {
  assert.match(accessReassertionMigration, /revoke all[\s\S]*registrar_venta_v3[\s\S]*service_role/i);
  assert.match(accessReassertionMigration, /revoke all[\s\S]*registrar_venta_v4[\s\S]*from public, anon/i);
  assert.match(accessReassertionMigration, /grant execute[\s\S]*registrar_venta_v4[\s\S]*authenticated, service_role/i);
  assert.match(accessReassertionMigration, /has_function_privilege\('anon', v_v3, 'execute'\)/);
  assert.match(accessReassertionMigration, /has_function_privilege\('service_role', v_v3, 'execute'\)/);
  assert.match(accessReassertionMigration, /v3 y v4 no tienen el mismo owner/);
});
