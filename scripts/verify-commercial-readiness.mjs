import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const contract = JSON.parse(readFileSync(resolve(root, "contracts/commercial-readiness.json"), "utf8"));
const allowedStatuses = new Set(["pass_automated", "pass_manual", "pending_live", "pending_manual", "pending_implementation", "blocked"]);
const fail = (message) => { console.error(`FAIL: ${message}`); process.exitCode = 1; };
const pass = (message) => console.log(`PASS: ${message}`);

if (contract.schemaVersion !== 1) fail("unsupported commercial readiness schema");
if (contract.branch !== "refactor/modular-runtime") fail("unexpected readiness branch");
if (!/^\d{4}-\d{2}-\d{2}$/.test(contract.updatedAt ?? "")) fail("invalid readiness update date");

const ids = new Set();
for (const gate of contract.gates ?? []) {
  if (!gate.id || ids.has(gate.id)) fail(`invalid or duplicate gate id: ${gate.id ?? "missing"}`);
  ids.add(gate.id);
  if (!allowedStatuses.has(gate.status)) fail(`gate ${gate.id} has unknown status ${gate.status}`);
  if (typeof gate.blocksPilot !== "boolean") fail(`gate ${gate.id} must declare blocksPilot`);
  if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) fail(`gate ${gate.id} has no evidence`);
  for (const evidence of gate.evidence ?? []) {
    if (!existsSync(resolve(root, evidence))) fail(`gate ${gate.id} references missing evidence: ${evidence}`);
  }
  if (gate.status === "blocked" && !gate.reason) fail(`blocked gate ${gate.id} has no reason`);
  if (gate.status === "pass_manual" && !/^\d{4}-\d{2}-\d{2}$/.test(gate.observedAt ?? "")) fail(`manual gate ${gate.id} needs an observation date`);
}
if (!process.exitCode) pass(`${ids.size} commercial readiness gates have valid evidence`);

const declaredMigrations = contract.migrationChain?.files ?? [];
const actualMigrations = readdirSync(resolve(root, "supabase/migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => `supabase/migrations/${file}`);
if (JSON.stringify(declaredMigrations) !== JSON.stringify(actualMigrations)) fail("commercial readiness migration inventory is stale or out of order");
else pass(`${actualMigrations.length} reviewed migrations are inventoried in execution order`);
if (declaredMigrations.some((file) => file.includes("/legacy/") || file.includes("/sources/"))) fail("non-executable legacy/source SQL entered the migration chain");

const bootstrapGate = contract.gates.find((gate) => gate.id === "database-clean-bootstrap");
if (contract.migrationChain?.baselineRequired && !contract.migrationChain?.baselineManifest) {
  if (bootstrapGate?.status !== "blocked" || bootstrapGate.blocksPilot !== true) fail("missing database baseline must remain an explicit pilot blocker");
  else pass("incremental database baseline dependency is explicit and blocks the pilot");
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.scripts?.["qa:commercial"] !== "node scripts/verify-commercial-readiness.mjs") fail("package.json does not expose qa:commercial");
if (!packageJson.scripts?.ci?.includes("npm run qa:commercial")) fail("commercial readiness verification is not part of CI");

const matrix = readFileSync(resolve(root, "docs/audit/MATRIZ-QA-v2.31.1.md"), "utf8");
for (const marker of ["PENDIENTE LIVE", "Condiciones del gate de piloto", "dos cajas distintas del mismo negocio", "baseline SQL ejecutable"]) {
  if (!matrix.includes(marker)) fail(`QA matrix is missing marker: ${marker}`);
}

const blockers = contract.gates.filter((gate) => gate.blocksPilot && !gate.status.startsWith("pass_"));
console.log(`INFO: pilot blockers open: ${blockers.length}`);
for (const gate of blockers) console.log(`PENDING: ${gate.id} (${gate.status})`);
if (process.exitCode) process.exit(process.exitCode);
pass("commercial readiness contract is current and enforced by CI");
