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
for (const relation of manifest.requiredRelations ?? []) {
  if (!relation.name || names.has(relation.name)) fail(`invalid or duplicate relation: ${relation.name ?? "missing"}`);
  names.add(relation.name);
  if (!Array.isArray(relation.definitionSources)) fail(`relation ${relation.name} has invalid sources`);
  if (relation.definitionSources?.length === 0) derivedMissing.push(relation.name);
  for (const source of relation.definitionSources ?? []) {
    if (!existsSync(resolve(root, source))) fail(`relation ${relation.name} references missing source: ${source}`);
    const sql = readFileSync(resolve(root, source), "utf8");
    const escaped = relation.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+public\\.${escaped}\\b`, "i").test(sql)) {
      fail(`source does not create public.${relation.name}: ${source}`);
    }
  }
}

const declaredMissing = [...(manifest.missingAuthoritativeDefinitions ?? [])].sort();
if (JSON.stringify(derivedMissing.sort()) !== JSON.stringify(declaredMissing)) fail("missing baseline definitions are stale");
if (declaredMissing.length > 0 && manifest.status !== "incomplete") fail("baseline with missing definitions must remain incomplete");
if (declaredMissing.length === 0 && manifest.status !== "ready_for_disposable_test") fail("complete source inventory must advance to disposable testing");
if (!manifest.allowedRecoveryMethod || !Array.isArray(manifest.forbiddenShortcuts)) fail("baseline recovery safety policy is incomplete");
if (!manifest.captureDiagnostic || !existsSync(resolve(root, manifest.captureDiagnostic))) fail("baseline capture diagnostic is missing");

if (process.exitCode) process.exit(process.exitCode);
pass(`${names.size} pre-v2.31 relations inventoried; ${declaredMissing.length} authoritative definitions missing`);
for (const name of declaredMissing) console.log(`MISSING: public.${name}`);
pass("database baseline gap is explicit and safe recovery rules are present");
