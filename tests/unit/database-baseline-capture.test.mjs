import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  generateDatabaseBaseline,
  validateDatabaseBaseline
} from "../../dist-ts/platform/database-baseline-contract.js";

const root = resolve(import.meta.dirname, "../..");
const sql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_baseline_capture.sql"), "utf8");
const functionSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_trigger_function_capture.sql"), "utf8");
const stockHelperSql = readFileSync(resolve(root, "supabase/diagnostics/pre_v231_stock_helper_capture.sql"), "utf8");
const stockHelperCapture = JSON.parse(readFileSync(resolve(root, "contracts/captures/pre-v231-stock-helper-20260915.json"), "utf8"));
const coreBaselineSql = readFileSync(resolve(root, "supabase/baseline/000_v1_core.sql"), "utf8");
const branchStockBaselineSql = readFileSync(resolve(root, "supabase/baseline/010_v226_branch_stock.sql"), "utf8");
const baselineValidationSql = readFileSync(resolve(root, "supabase/baseline/validate_pre_v231_baseline.sql"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/database-baseline.json"), "utf8"));
const assembly = JSON.parse(readFileSync(resolve(root, "supabase/baseline/assembly.json"), "utf8"));
const capture = JSON.parse(readFileSync(resolve(root, manifest.captureEvidence), "utf8"));
const dependencyCapture = JSON.parse(readFileSync(resolve(root, manifest.dependencyCaptureEvidence), "utf8"));
const transitiveCapture = JSON.parse(readFileSync(resolve(root, manifest.transitiveDependencyCaptureEvidence), "utf8"));

function baselineWorkspace(overrides = {}) {
  const referencedPaths = new Set([
    manifest.executableBaseline,
    manifest.validationDiagnostic,
    manifest.captureDiagnostic,
    manifest.dependencyCaptureDiagnostic,
    manifest.transitiveDependencyCaptureDiagnostic,
    "supabase/baseline/000_v1_core.sql",
    "supabase/baseline/010_v226_branch_stock.sql",
    ...assembly.steps,
    ...manifest.requiredRelations.flatMap((relation) => relation.definitionSources)
  ]);
  const files = Object.fromEntries([...referencedPaths].map((path) => [
    path,
    readFileSync(resolve(root, path), "utf8")
  ]));
  return { manifest, assembly, capture, dependencyCapture, transitiveCapture, files, ...overrides };
}

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
  const safe = generateDatabaseBaseline({
    assembly: { steps: ["one.sql", "two.sql"] },
    sourceSql: { "one.sql": "begin;\r\nselect 1;", "two.sql": "select 2;\ncommit;" }
  });
  assert.deepEqual(safe.errors, []);
  assert.match(safe.content, /GENERATED FILE\. DO NOT EDIT/);
  assert.match(safe.content, /empty disposable Supabase project only/i);
  assert.equal(safe.transactionCount, 1);
  assert.equal(safe.content.includes("\r\n"), false);

  const unsafe = generateDatabaseBaseline({
    assembly: { steps: ["unsafe.sql"] },
    sourceSql: { "unsafe.sql": "drop table public.ventas;\n-- service_role" }
  });
  assert.equal(unsafe.content, null);
  assert.deepEqual(unsafe.errors, [
    "Destructive DROP TABLE/SCHEMA is forbidden in the clean bootstrap package",
    "Privileged service credentials or roles are forbidden in the bootstrap package"
  ]);
});

test("baseline contract validates the repository through its interface", () => {
  const result = validateDatabaseBaseline(baselineWorkspace());
  assert.deepEqual(result.errors, []);
  assert.equal(result.relationCount, manifest.requiredRelations.length);
  assert.equal(result.status, "validated_local_disposable");
});

test("baseline contract accumulates independent structural failures", () => {
  const invalidAssembly = { ...assembly, target: "production", steps: [...assembly.steps].reverse() };
  const result = validateDatabaseBaseline(baselineWorkspace({ assembly: invalidAssembly }));
  assert.ok(result.errors.includes("baseline assembly draft has an unsafe status or target"));
  assert.ok(result.errors.includes("baseline assembly must start with the v1 core"));
  assert.ok(result.errors.includes("branch stock must be assembled after multi-tenant foundations"));
});

test("baseline contract rejects malformed external values without throwing", () => {
  const result = validateDatabaseBaseline({
    manifest: null,
    assembly: [],
    capture: "invalid",
    dependencyCapture: 42,
    transitiveCapture: false,
    files: {}
  });

  assert.ok(result.errors.includes("unsupported database baseline schema"));
  assert.ok(result.errors.includes("database baseline has no required relations"));
  assert.ok(result.errors.includes("baseline assembly draft is missing"));
  assert.ok(result.errors.includes("baseline capture evidence is missing"));
  assert.ok(result.errors.includes("baseline trigger-function evidence is missing"));
  assert.ok(result.errors.includes("baseline transitive dependency evidence is missing"));
});

test("validated local status requires local evidence while remote validation may remain pending", () => {
  const current = validateDatabaseBaseline(baselineWorkspace());
  assert.deepEqual(current.errors, []);
  assert.equal(assembly.validation.disposableProject, "pending");

  const invalidManifest = { ...manifest, localValidation: { ...manifest.localValidation, resetResult: "pending" } };
  const mismatchedAssembly = { ...assembly, status: "ready_for_disposable_test" };
  const invalid = validateDatabaseBaseline(baselineWorkspace({
    manifest: invalidManifest,
    assembly: mismatchedAssembly
  }));
  assert.ok(invalid.errors.includes("validated local baseline lacks complete local validation evidence"));
  assert.ok(invalid.errors.includes("baseline manifest and assembly statuses disagree"));
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
