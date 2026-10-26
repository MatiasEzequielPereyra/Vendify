import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminReleaseRoutes, validateAdminReleaseTarget, verifyAdminReleaseOutput } from "./package-admin-release.mjs";
import { inventory, verifyAdminEntry } from "./verify-admin-entry.mjs";
import { loadProductionReleaseContract, verifyProductionReleaseArtifact } from "./production-release-baseline.mjs";

export function resolveIsolatedPreviewTarget(env, contract, actualHead) {
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_PROJECT_ID !== contract.projectId || env.VERCEL_GIT_COMMIT_REF !== "feature/ven-admin-001b1-read-model" || env.VERCEL_GIT_COMMIT_SHA !== actualHead) throw new Error("Isolated administration requires exact Preview project, branch and SHA");
  const host = env.VERCEL_URL;
  if (typeof host !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/.test(host) || host === env.VERCEL_PROJECT_PRODUCTION_URL || host === env.VERCEL_BRANCH_URL || host === contract.stableHost) throw new Error("Fresh unique administration Preview hostname required");
  return host;
}

export function isolatedPreviewRoutes(baselineConfig, contract, previewHost, adminPaths) {
  const stable = getAdminReleaseRoutes(baselineConfig, contract.stableHost, adminPaths);
  const preview = getAdminReleaseRoutes(baselineConfig, previewHost, adminPaths);
  // Both exact hosts, one final deny; no POS fallback or service worker files.
  return [...stable.slice(0, -1), ...preview.slice(0, -1), stable.at(-1)];
}

export function packageIsolatedPreview({ root, env = process.env }) {
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const contract = { ...JSON.parse(readFileSync(resolve(root, "contracts/admin-release-target.json"), "utf8")), sourceHead: actualHead };
  const baseline = resolve(root, "dist");
  const provenance = verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
  validateAdminReleaseTarget(contract, { actualHead, baselineDigest: provenance.digest });
  const previewHost = resolveIsolatedPreviewTarget(env, contract, actualHead);
  const artifact = resolve(root, "dist-admin-release");
  verifyAdminEntry({ baseline, target: artifact });
  const paths = Object.keys(inventory(resolve(artifact, "admin"))).map(path => "admin/" + path);
  const config = { version: 3, routes: isolatedPreviewRoutes(JSON.parse(readFileSync(resolve(baseline, "vercel.json"), "utf8")), contract, previewHost, paths) };
  const output = resolve(root, ".vercel/output");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(resolve(output, "static"), { recursive: true });
  cpSync(resolve(artifact, "admin"), resolve(output, "static/admin"), { recursive: true });
  writeFileSync(resolve(output, "config.json"), JSON.stringify(config, null, 2) + "\n");
  verifyAdminReleaseOutput({ output, artifact, config });
  verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
  return { previewHost, files: inventory(output) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = packageIsolatedPreview({ root: resolve(dirname(fileURLToPath(import.meta.url)), "..") });
  console.log(`PASS: isolated administrative Preview ${result.previewHost}; ${Object.keys(result.files).length} output files; no POS files`);
}
