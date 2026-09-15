import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const sql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_baseline_capture.sql"), "utf8");
const functionSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_trigger_function_capture.sql"), "utf8");
const stockHelperSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_stock_helper_capture.sql"), "utf8");
const stockHelperCapture = JSON.parse(readFileSync(resolve(root, "contracts/captures/pre-v231-stock-helper-20260915.json"), "utf8"));
const coreBaselineSql = readFileSync(resolve(root, "supabase/baseline/000_v1_core.sql"), "utf8");
const branchStockBaselineSql = readFileSync(resolve(root, "supabase/baseline/010_v226_branch_stock.sql"), "utf8");
const baselineValidationSql = readFileSync(resolve(root, "supabase/baseline/validate_pre_v231_baseline.sql"), "utf8");

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
  assert.match(stockHelperSql, /recalcular_stock_total_producto_v1\(uuid\)/i);
  assert.match(stockHelperSql, /pg_catalog\.pg_get_functiondef\(oid\)/i);
  assert.match(stockHelperSql, /missing_functions/i);
  assert.doesNotMatch(statements, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
});

test("captured stock helper preserves the aggregate and security contract", () => {
  assert.deepEqual(stockHelperCapture.missing_functions, []);
  const helper = stockHelperCapture.functions.find((fn) => fn.identity === "public.recalcular_stock_total_producto_v1(uuid)");
  assert.ok(helper);
  assert.match(helper.definition, /security definer/i);
  assert.match(helper.definition, /set search_path to 'public'/i);
  assert.match(helper.definition, /sum\(ps\.stock\)/i);
  assert.match(helper.definition, /where ps\.producto_id = p_producto_id/i);
});

test("baseline draft builds core tables before branch stock", () => {
  for (const relation of ["categorias", "productos", "movimientos", "ventas", "venta_items"]) {
    assert.match(coreBaselineSql, new RegExp(`create\\s+table\\s+public\\.${relation}\\b`, "i"));
  }
  assert.match(branchStockBaselineSql, /create table public\.producto_stock_sucursal/i);
  assert.match(branchStockBaselineSql, /sum\(ps\.stock\)/i);
  assert.match(branchStockBaselineSql, /after insert or delete or update of stock/i);
});

test("baseline package generator is deterministic and restricted to disposable projects", () => {
  const generator = readFileSync(resolve(root, "scripts/build-database-baseline.mjs"), "utf8");
  assert.match(generator, /GENERATED FILE\. DO NOT EDIT/);
  assert.match(generator, /empty disposable Supabase project only/i);
  assert.match(generator, /process\.argv\.includes\("--check"\)/);
  assert.match(generator, /Unbalanced baseline transactions/);
  assert.match(generator, /Destructive DROP TABLE\/SCHEMA is forbidden/);
  assert.match(generator, /service_role\|SUPABASE_SERVICE/);
});

test("post-bootstrap validation is read-only and checks structural dependencies", () => {
  const statements = baselineValidationSql.replace(/^\s*--.*$/gm, "");
  for (const marker of ["missing_relations", "missing_functions", "missing_columns", "missing_triggers"]) {
    assert.match(baselineValidationSql, new RegExp(marker));
  }
  assert.match(baselineValidationSql, /vendify_pre_v231_baseline_validation/);
  assert.doesNotMatch(statements, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im);
});

test("baseline capture includes security and structural metadata", () => {
  for (const marker of ["pg_get_constraintdef", "pg_get_triggerdef", "pg_indexes", "pg_policies", "role_table_grants", "relrowsecurity"]) {
    assert.ok(sql.includes(marker), `missing capture marker ${marker}`);
  }
});
