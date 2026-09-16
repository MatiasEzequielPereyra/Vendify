import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assemblyPath = resolve(root, "supabase/baseline/assembly.json");
const outputPath = resolve(root, "supabase/baseline/vendify_pre_v231_baseline.sql");
const localMigrationPath = resolve(root, "supabase/migrations/20260830000000_pre_v231_baseline.local.sql");
const assembly = JSON.parse(readFileSync(assemblyPath, "utf8"));

if (!Array.isArray(assembly.steps) || assembly.steps.length === 0) {
  throw new Error("Baseline assembly has no ordered steps");
}

const sections = assembly.steps.map((relativePath, index) => {
  const absolutePath = resolve(root, relativePath);
  if (!existsSync(absolutePath)) throw new Error(`Missing baseline step: ${relativePath}`);
  const sql = readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n").trimEnd();
  return [
    `-- ============================================================================`,
    `-- STEP ${String(index + 1).padStart(2, "0")}: ${relativePath}`,
    `-- ============================================================================`,
    sql
  ].join("\n");
});

const generated = [
  "-- GENERATED FILE. DO NOT EDIT.",
  "-- Vendify pre-v2.31 clean bootstrap candidate.",
  "-- Target: empty disposable Supabase project only until live validation passes.",
  "-- Source order: supabase/baseline/assembly.json",
  "",
  ...sections,
  ""
].join("\n\n");

const transactionBegins = generated.match(/^\s*begin;\s*$/gim)?.length ?? 0;
const transactionCommits = generated.match(/^\s*commit;\s*$/gim)?.length ?? 0;
if (transactionBegins !== transactionCommits) {
  throw new Error(`Unbalanced baseline transactions: ${transactionBegins} BEGIN / ${transactionCommits} COMMIT`);
}
if (/^\s*drop\s+(?:table|schema)\b/im.test(generated)) {
  throw new Error("Destructive DROP TABLE/SCHEMA is forbidden in the clean bootstrap package");
}
if (/service_role|SUPABASE_SERVICE/i.test(generated)) {
  throw new Error("Privileged service credentials or roles are forbidden in the bootstrap package");
}

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") !== generated) {
    console.error("FAIL: generated database baseline is stale; run npm run build:database-baseline");
    process.exit(1);
  }
  console.log(`PASS: generated database baseline matches ${assembly.steps.length} ordered sources with ${transactionBegins} balanced transactions`);
} else {
  writeFileSync(outputPath, generated, "utf8");
  if (process.argv.includes("--local-migration")) {
    writeFileSync(localMigrationPath, generated, "utf8");
    console.log("Local disposable migration generated before the v2.31 chain.");
  }
  console.log(`Vendify database baseline generated from ${assembly.steps.length} ordered sources.`);
}
