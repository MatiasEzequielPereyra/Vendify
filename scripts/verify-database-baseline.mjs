import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateDatabaseBaseline } from "../dist-ts/platform/database-baseline-contract.js";

const root = resolve(import.meta.dirname, "..");
const readText = (relativePath) => {
  if (!relativePath) return undefined;
  const absolutePath = resolve(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : undefined;
};
const readJson = (relativePath) => {
  const content = readText(relativePath);
  return content === undefined ? null : JSON.parse(content);
};
const strings = (value) => Array.isArray(value)
  ? value.filter((entry) => typeof entry === "string")
  : [];

const manifest = readJson("contracts/database-baseline.json");
const assembly = readJson(manifest?.assemblyDraft);
const referencedPaths = new Set([
  manifest?.executableBaseline,
  manifest?.validationDiagnostic,
  manifest?.captureDiagnostic,
  manifest?.dependencyCaptureDiagnostic,
  manifest?.transitiveDependencyCaptureDiagnostic,
  "supabase/baseline/000_v1_core.sql",
  "supabase/baseline/010_v226_branch_stock.sql",
  ...strings(assembly?.steps),
  ...(Array.isArray(manifest?.requiredRelations)
    ? manifest.requiredRelations.flatMap((relation) => strings(relation?.definitionSources))
    : [])
].filter((path) => typeof path === "string"));
const files = Object.fromEntries([...referencedPaths].map((path) => [path, readText(path)]));
const result = validateDatabaseBaseline({
  manifest,
  assembly,
  capture: readJson(manifest?.captureEvidence),
  dependencyCapture: readJson(manifest?.dependencyCaptureEvidence),
  transitiveCapture: readJson(manifest?.transitiveDependencyCaptureEvidence),
  files
});

for (const error of result.errors) console.error(`FAIL: ${error}`);
if (result.errors.length > 0) process.exit(1);

console.log(`PASS: ${result.relationCount} pre-v2.31 relations inventoried; ${result.missingDefinitions.length} authoritative definitions missing`);
for (const name of result.missingDefinitions) console.log(`MISSING: public.${name}`);
if (!result.executableBaseline) {
  console.log(`PENDING: dependency-ordered executable baseline assembly; ${result.missingExecutableDependencies.length} executable dependencies require authoritative capture`);
} else if (result.status === "validated_local_disposable") {
  console.log(`VALIDATED: ${result.executableBaseline} passed local disposable execution`);
} else {
  console.log(`READY: ${result.executableBaseline} awaits disposable-project execution`);
}
for (const dependency of result.missingExecutableDependencies) {
  console.log(`MISSING DEPENDENCY: ${dependency}`);
}
console.log("PASS: database baseline gap is explicit and safe recovery rules are present");
