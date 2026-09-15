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
if (manifest.executableBaseline && manifest.status !== "ready_for_disposable_test") fail("an executable baseline must advance to disposable testing");
if (!manifest.allowedRecoveryMethod || !Array.isArray(manifest.forbiddenShortcuts)) fail("baseline recovery safety policy is incomplete");
if (!manifest.captureDiagnostic || !existsSync(resolve(root, manifest.captureDiagnostic))) fail("baseline capture diagnostic is missing");
if (!manifest.dependencyCaptureDiagnostic || !existsSync(resolve(root, manifest.dependencyCaptureDiagnostic))) fail("baseline dependency capture diagnostic is missing");
if (!manifest.transitiveDependencyCaptureDiagnostic || !existsSync(resolve(root, manifest.transitiveDependencyCaptureDiagnostic))) fail("baseline transitive dependency diagnostic is missing");
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
for (const dependency of manifest.missingExecutableDependencies) console.log(`MISSING DEPENDENCY: ${dependency}`);
pass("database baseline gap is explicit and safe recovery rules are present");
