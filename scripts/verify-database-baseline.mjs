import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "contracts/database-baseline.json"), "utf8"));
const fail = (message) => { console.error(`FAIL: ${message}`); process.exitCode = 1; };
const pass = (message) => console.log(`PASS: ${message}`);

if (manifest.schemaVersion !== 1) fail("unsupported database baseline schema");
if (!Array.isArray(manifest.requiredRelations) || manifest.requiredRelations.length === 0) fail("database baseline has no required relations");

const names = new Set();
const derivedMissing = [];
const capturePath = manifest.captureEvidence ? resolve(root, manifest.captureEvidence) : null;
const capture = capturePath && existsSync(capturePath)
  ? JSON.parse(readFileSync(capturePath, "utf8"))
  : null;
const dependencyCapturePath = manifest.dependencyCaptureEvidence ? resolve(root, manifest.dependencyCaptureEvidence) : null;
const dependencyCapture = dependencyCapturePath && existsSync(dependencyCapturePath)
  ? JSON.parse(readFileSync(dependencyCapturePath, "utf8"))
  : null;
const transitiveCapturePath = manifest.transitiveDependencyCaptureEvidence ? resolve(root, manifest.transitiveDependencyCaptureEvidence) : null;
const transitiveCapture = transitiveCapturePath && existsSync(transitiveCapturePath)
  ? JSON.parse(readFileSync(transitiveCapturePath, "utf8"))
  : null;
const capturedRelations = new Map((capture?.relations ?? []).map((relation) => [relation.name, relation]));
for (const relation of manifest.requiredRelations ?? []) {
  if (!relation.name || names.has(relation.name)) fail(`invalid or duplicate relation: ${relation.name ?? "missing"}`);
  names.add(relation.name);
  if (!Array.isArray(relation.definitionSources)) fail(`relation ${relation.name} has invalid sources`);
  if (relation.definitionSources?.length === 0) derivedMissing.push(relation.name);
  for (const source of relation.definitionSources ?? []) {
    if (!existsSync(resolve(root, source))) fail(`relation ${relation.name} references missing source: ${source}`);
    if (source.endsWith(".json")) {
      const captured = capturedRelations.get(relation.name);
      if (!captured || !Array.isArray(captured.columns) || captured.columns.length === 0) fail(`capture has no structural definition for public.${relation.name}`);
    } else {
      const sql = readFileSync(resolve(root, source), "utf8");
      const escaped = relation.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${escaped}\\b`, "i").test(sql)) fail(`source does not create public.${relation.name}: ${source}`);
    }
  }
}

const declaredMissing = [...(manifest.missingAuthoritativeDefinitions ?? [])].sort();
if (JSON.stringify(derivedMissing.sort()) !== JSON.stringify(declaredMissing)) fail("missing baseline definitions are stale");
if (declaredMissing.length > 0 && manifest.status !== "incomplete") fail("baseline with missing definitions must remain incomplete");
if (declaredMissing.length === 0 && !manifest.executableBaseline && manifest.status !== "captured_core_relations") fail("captured source inventory must remain in assembly state");
if (manifest.executableBaseline && !["ready_for_disposable_test", "validated_local_disposable"].includes(manifest.status)) fail("an executable baseline must advance to disposable testing");
if (manifest.executableBaseline && !existsSync(resolve(root, manifest.executableBaseline))) fail("executable baseline file is missing");
if (!manifest.validationDiagnostic || !existsSync(resolve(root, manifest.validationDiagnostic))) fail("baseline validation diagnostic is missing");
if (!manifest.allowedRecoveryMethod || !Array.isArray(manifest.forbiddenShortcuts)) fail("baseline recovery safety policy is incomplete");
if (!manifest.captureDiagnostic || !existsSync(resolve(root, manifest.captureDiagnostic))) fail("baseline capture diagnostic is missing");
if (!manifest.dependencyCaptureDiagnostic || !existsSync(resolve(root, manifest.dependencyCaptureDiagnostic))) fail("baseline dependency capture diagnostic is missing");
if (!manifest.transitiveDependencyCaptureDiagnostic || !existsSync(resolve(root, manifest.transitiveDependencyCaptureDiagnostic))) fail("baseline transitive dependency diagnostic is missing");
if (!transitiveCapture) fail("baseline transitive dependency evidence is missing");
else {
  if (transitiveCapture.capture_version !== 1) fail("unsupported transitive dependency capture version");
  if ((transitiveCapture.missing_functions ?? []).length !== 0) fail("transitive dependency capture still reports missing functions");
  const stockHelper = (transitiveCapture.functions ?? []).find((fn) => fn.identity === "public.recalcular_stock_total_producto_v1(uuid)");
  if (!stockHelper?.definition) fail("transitive dependency evidence is missing the stock-total helper definition");
  else {
    if (!/security definer/i.test(stockHelper.definition) || !/set search_path to 'public'/i.test(stockHelper.definition)) fail("captured stock-total helper lacks its security contract");
    if (!/sum\(ps\.stock\)/i.test(stockHelper.definition) || !/where ps\.producto_id = p_producto_id/i.test(stockHelper.definition)) fail("captured stock-total helper lacks its aggregate invariant");
  }
}
if (!dependencyCapture) fail("baseline trigger-function evidence is missing");
else {
  if (dependencyCapture.capture_version !== 1) fail("unsupported trigger-function capture version");
  const capturedFunctions = new Set((dependencyCapture.functions ?? []).map((fn) => `${fn.schema}.${fn.name}(${fn.identity_arguments})`));
  for (const expected of [
    "public.crear_stock_sucursales_producto_v1()",
    "public.stock_sucursal_recalcular_total_trigger_v1()",
    "public.validar_autorizacion_descuento_venta_v1()"
  ]) {
    if (!capturedFunctions.has(expected)) fail(`trigger-function evidence is missing ${expected}`);
  }
}
if (!Array.isArray(manifest.missingExecutableDependencies)) fail("baseline executable dependency inventory is missing");
const assemblyPath = manifest.assemblyDraft ? resolve(root, manifest.assemblyDraft) : null;
const assembly = assemblyPath && existsSync(assemblyPath)
  ? JSON.parse(readFileSync(assemblyPath, "utf8"))
  : null;
if (!assembly) fail("baseline assembly draft is missing");
else {
  if (!["assembling", "ready_for_disposable_test", "validated_local_disposable"].includes(assembly.status) || assembly.target !== "empty_disposable_supabase_project") fail("baseline assembly draft has an unsafe status or target");
  if (!Array.isArray(assembly.steps) || assembly.steps.length === 0) fail("baseline assembly has no ordered steps");
  for (const step of assembly.steps ?? []) {
    if (!existsSync(resolve(root, step))) fail(`baseline assembly references missing step: ${step}`);
  }
  if (assembly.steps?.[0] !== "supabase/baseline/000_v1_core.sql") fail("baseline assembly must start with the v1 core");
  const multiTenantIndex = assembly.steps?.indexOf("supabase/legacy/001_multiempresa_roles_sucursales_FIX.sql");
  const branchStockIndex = assembly.steps?.indexOf("supabase/baseline/010_v226_branch_stock.sql");
  if (multiTenantIndex < 0 || branchStockIndex <= multiTenantIndex) fail("branch stock must be assembled after multi-tenant foundations");

  const coreSql = readFileSync(resolve(root, "supabase/baseline/000_v1_core.sql"), "utf8");
  for (const relation of ["categorias", "productos", "movimientos", "ventas", "venta_items"]) {
    if (!new RegExp(`create\\s+table\\s+public\\.${relation}\\b`, "i").test(coreSql)) fail(`v1 core does not create public.${relation}`);
  }
  const branchStockSql = readFileSync(resolve(root, "supabase/baseline/010_v226_branch_stock.sql"), "utf8");
  for (const marker of ["producto_stock_sucursal", "recalcular_stock_total_producto_v1", "stock_sucursal_recalcular_total_trigger_v1", "crear_stock_sucursales_producto_v1"]) {
    if (!branchStockSql.includes(marker)) fail(`branch-stock foundation lacks ${marker}`);
  }
  const validationSql = readFileSync(resolve(root, manifest.validationDiagnostic), "utf8");
  if (!/vendify_pre_v231_baseline_validation/i.test(validationSql) || !/'ok'/i.test(validationSql)) fail("baseline validation diagnostic lacks its result contract");
  const validationStatements = validationSql.replace(/^\s*--.*$/gm, "");
  if (/^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/im.test(validationStatements)) fail("baseline validation diagnostic must remain read-only");
}
if (!capture) fail("baseline capture evidence is missing");
else {
  if (capture.capture_version !== 1) fail("unsupported baseline capture version");
  if ((capture.missing_relations ?? []).length !== 0) fail("baseline capture reports missing relations");
  const expected = [...names].filter((name) => capturedRelations.has(name)).sort();
  const actual = [...capturedRelations.keys()].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail("baseline capture relation inventory is unexpected");
}

if (process.exitCode) process.exit(process.exitCode);
pass(`${names.size} pre-v2.31 relations inventoried; ${declaredMissing.length} authoritative definitions missing`);
for (const name of declaredMissing) console.log(`MISSING: public.${name}`);
if (!manifest.executableBaseline) console.log(`PENDING: dependency-ordered executable baseline assembly; ${manifest.missingExecutableDependencies.length} executable dependencies require authoritative capture`);
else if (manifest.status === "validated_local_disposable") console.log(`VALIDATED: ${manifest.executableBaseline} passed local disposable execution`);
else console.log(`READY: ${manifest.executableBaseline} awaits disposable-project execution`);
for (const dependency of manifest.missingExecutableDependencies) console.log(`MISSING DEPENDENCY: ${dependency}`);
pass("database baseline gap is explicit and safe recovery rules are present");
