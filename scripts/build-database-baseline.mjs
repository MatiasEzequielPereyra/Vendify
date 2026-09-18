import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateDatabaseBaseline } from "../dist-ts/platform/database-baseline-contract.js";

const root = resolve(import.meta.dirname, "..");
const assemblyPath = resolve(root, "supabase/baseline/assembly.json");
const outputPath = resolve(root, "supabase/baseline/vendify_pre_v231_baseline.sql");
const localMigrationPath = resolve(root, "supabase/migrations/20260830000000_pre_v231_baseline.local.sql");
const assembly = JSON.parse(readFileSync(assemblyPath, "utf8"));

if (!Array.isArray(assembly.steps) || assembly.steps.length === 0) {
  throw new Error("Baseline assembly has no ordered steps");
}

const sourceSql = Object.fromEntries(assembly.steps.map((relativePath) => {
  const absolutePath = resolve(root, relativePath);
  return [relativePath, existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : undefined];
}));
const generation = generateDatabaseBaseline({ assembly, sourceSql });
if (generation.errors.length > 0 || generation.content === null) {
  throw new Error(generation.errors.join("\n"));
}
const generated = generation.content;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8").replace(/\r\n/g, "\n") !== generated) {
    console.error("FAIL: generated database baseline is stale; run npm run build:database-baseline");
    process.exit(1);
  }
  console.log(`PASS: generated database baseline matches ${generation.stepCount} ordered sources with ${generation.transactionCount} balanced transactions`);
} else {
  writeFileSync(outputPath, generated, "utf8");
  if (process.argv.includes("--local-migration")) {
    writeFileSync(localMigrationPath, generated, "utf8");
    console.log("Local disposable migration generated before the v2.31 chain.");
  }
  console.log(`Vendify database baseline generated from ${assembly.steps.length} ordered sources.`);
}
