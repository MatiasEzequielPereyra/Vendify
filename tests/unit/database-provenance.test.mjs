import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const contract = JSON.parse(readFileSync(resolve(root, "contracts/database-provenance.json"), "utf8"));
const capture = JSON.parse(readFileSync(resolve(root, contract.scope.liveCapture), "utf8"));
const readiness = JSON.parse(readFileSync(resolve(root, "contracts/commercial-readiness.json"), "utf8"));
const diagnostic = readFileSync(resolve(root, "supabase/diagnostics/database_provenance_capture.sql"), "utf8");

test("VEN-003 provenance contract is pinned to an immutable repo SHA and production remained read-only", () => {
  assert.match(contract.repository.baseSha, /^[0-9a-f]{40}$/);
  assert.equal(contract.repository.baseBranch, "refactor/modular-runtime");
  assert.equal(contract.repository.workingBranch, "fix/ven-003-database-provenance");
  assert.equal(contract.production.projectRef, "puhkmblnptntorwptvld");
  assert.equal(contract.productionMutationsPerformed, "NONE");
  assert.equal(contract.scope.productionAccess, "READ_ONLY_METADATA_ONLY");
  assert.equal(contract.scope.businessRowsRead, false);
  assert.equal(capture.productionMutationsPerformed, "NONE");
});

test("repo migration inventory is complete, ordered and identical to commercial readiness", () => {
  const inventory = contract.repoMigrationInventory.map((entry) => entry.file);
  const actual = readdirSync(resolve(root, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".local.sql"))
    .sort()
    .map((file) => `supabase/migrations/${file}`);
  assert.deepEqual(inventory, readiness.migrationChain.files);
  assert.deepEqual(inventory, actual);
  assert.equal(inventory.length, 22);
});

test("live capture contains schema metadata only and no business row counts", () => {
  assert.equal(capture.project.ref, contract.production.projectRef);
  assert.deepEqual(capture.migrationHistory.listMigrations, []);
  assert.equal(capture.migrationHistory.relationPresent, false);
  assert.equal(capture.publicTables.length, 34);
  assert.ok(capture.publicTables.every((table) => table.rls_enabled === true));
  assert.ok(capture.publicTables.every((table) => !Object.hasOwn(table, "rows")));
  for (const key of ["constraints","indexes","functions","policies","tableGrants","triggers","installedExtensions"]) {
    assert.ok(Array.isArray(capture[key]), `missing capture array ${key}`);
  }
});

test("reconciliation explicitly separates live-only, intentional non-deployment and definition drift", () => {
  assert.deepEqual(
    contract.reconciliation.liveOnlyObjects.map((entry) => entry.object).sort(),
    ["public.configuracion","public.equipo_invitaciones"]
  );
  assert.equal(contract.reconciliation.repoOnlyUnexpectedObjects.length, 0);
  const intended = contract.reconciliation.intentionallyNotDeployed.flatMap((entry) => entry.objects);
  for (const table of [
    "public.offline_sale_leases",
    "public.offline_sale_lease_product_quotas",
    "public.offline_sale_lease_usage",
    "public.operational_backups",
    "public.operational_backup_parts"
  ]) assert.ok(intended.includes(table));
  assert.ok(contract.reconciliation.definitionDrift.length >= 5);
  assert.equal(contract.historyEvidence.conclusion.includes("partially unknowable"), true);
});

test("diagnostic is read-only and restricted to metadata catalogs", () => {
  const executable = diagnostic
    .replace(/^\s*--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(executable, /^\s*(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|call)\b/im);
  assert.doesNotMatch(executable, /\bfrom\s+public\./i);
  for (const marker of [
    "information_schema.columns",
    "pg_constraint",
    "pg_indexes",
    "pg_proc",
    "pg_policies",
    "role_table_grants",
    "information_schema.triggers",
    "pg_extension"
  ]) assert.match(diagnostic, new RegExp(marker.replace(".", "\\."), "i"));
});

test("forward ledger strategy cannot replay or falsify historical migration state", () => {
  assert.equal(contract.forwardMigrationLedgerStrategy.status, "DEFINED_NOT_APPLIED");
  const forbidden = contract.forwardMigrationLedgerStrategy.explicitlyForbidden.join("\n");
  assert.match(forbidden, /Do not run the historical migration chain/i);
  assert.match(forbidden, /Do not mark all historical migrations as applied/i);
  assert.match(forbidden, /Do not mutate supabase_migrations\.schema_migrations/i);
  assert.equal(contract.conclusion.historicalProvenance, "PARTIALLY_UNKNOWABLE");
});
