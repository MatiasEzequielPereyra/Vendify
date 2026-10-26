import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { loadProductionReleaseContract, verifyProductionReleaseArtifact } from "./production-release-baseline.mjs";
import { inventory, verifyAdminEntry } from "./verify-admin-entry.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const baseline = resolve(root, "dist");
const target = resolve(root, "dist-admin-release");
// The original verifier runs on the original artifact before composition.
const provenance = verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
await build({ root, configFile: resolve(root, "vite.admin.config.ts") });
rmSync(target, { recursive: true, force: true });
cpSync(baseline, target, { recursive: true });
cpSync(resolve(root, ".vendify-build/admin-entry/admin"), resolve(target, "admin"), { recursive: true });
const publicSource = readFileSync(resolve(baseline, "supabase-config.js"), "utf8");
const configLines = ["SUPABASE_URL", "SUPABASE_ANON_KEY"].map(name => {
  const line = publicSource.match(new RegExp(`const ${name} = "[^"\\r\\n]+";`))?.[0];
  if (!line) throw new Error("Public configuration contract missing");
  return line;
});
writeFileSync(resolve(target, "admin/public-config.js"), configLines.join("\n") + "\n");
const files = inventory(resolve(target, "admin"));
mkdirSync(resolve(target, "admin"), { recursive: true });
writeFileSync(resolve(target, "admin/artifact-manifest.json"), JSON.stringify({ version: 1, baselineDigest: provenance.digest, files }, null, 2) + "\n");
verifyAdminEntry({ baseline, target });
// Reading this unchanged configuration here is intentional: no new Vercel rules.
if (!readFileSync(resolve(target, "vercel.json")).equals(readFileSync(resolve(baseline, "vercel.json")))) throw new Error("Vercel headers changed");
console.log("PASS: additive admin entry built; original POS inventory and bytes preserved");
