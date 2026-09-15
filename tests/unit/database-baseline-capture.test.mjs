import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const sql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_baseline_capture.sql"), "utf8");
const functionSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_trigger_function_capture.sql"), "utf8");
const stockHelperSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_stock_helper_capture.sql"), "utf8");

test("pre-v2.31 baseline capture is read-only and covers every missing relation", () => {
  const statements = sql.replace(/^\s*--.*$/gm, "");
  assert.doesNotMatch(statements, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
  for (const relation of ["categorias", "productos", "producto_stock_sucursal", "movimientos", "ventas", "venta_items"]) {
    assert.match(sql, new RegExp(`'${relation}'`));
  }
});

test("trigger-function capture is read-only and exports exact definitions", () => {
  const statements = functionSql.replace(/^\s*--.*$/gm, "");
  assert.match(functionSql, /pg_catalog\.pg_get_functiondef\(p\.oid\)/i);
  assert.match(functionSql, /not t\.tgisinternal/i);
  assert.match(functionSql, /vendify_pre_v231_trigger_function_capture/i);
  assert.doesNotMatch(statements, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
});

test("stock helper capture is read-only and reports missing dependencies", () => {
  const statements = stockHelperSql.replace(/^\s*--.*$/gm, "");
  assert.match(stockHelperSql, /recalcular_stock_total_producto_v1\(\)/i);
  assert.match(stockHelperSql, /pg_catalog\.pg_get_functiondef\(oid\)/i);
  assert.match(stockHelperSql, /missing_functions/i);
  assert.doesNotMatch(statements, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
});

test("baseline capture includes security and structural metadata", () => {
  for (const marker of ["pg_get_constraintdef", "pg_get_triggerdef", "pg_indexes", "pg_policies", "role_table_grants", "relrowsecurity"]) {
    assert.ok(sql.includes(marker), `missing capture marker ${marker}`);
  }
});
