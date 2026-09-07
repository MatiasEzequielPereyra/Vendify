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
