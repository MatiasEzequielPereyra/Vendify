import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAdminRoutes } from "./package-admin-vercel.mjs";
import { inventory, verifyAdminEntry } from "./verify-admin-entry.mjs";
import { loadProductionReleaseContract, verifyProductionReleaseArtifact } from "./production-release-baseline.mjs";

export const POS_PROJECT_ID = "prj_xYZevIAo7SwzsoUU1FV5hbGQEJXZ";
export const AUTHORIZED_TEAM_ID = "team_cJL8jHMV3R0hsr8C0kOkznph";
export const PRODUCTION_REF = "puhkmblnptntorwptvld";
export const BOOTSTRAP_PROJECT_ID = "prj_GBIFOT8NGgKEchQ0ZzC60EJiwyVy";
export const BOOTSTRAP_STABLE_HOST = "vendify-platform-admin-release.vercel.app";
// Expected Vercel-generated namespace for the explicitly authorized project.
// A local match does not prove a hosted URL's project identity; the operator
// must verify the resulting deployment and project through Vercel after upload.
export const BOOTSTRAP_HOST_PATTERN = "^vendify-platform-admin-release-[a-z0-9]+(?:-matiasezequielpereyras-projects)?\\.vercel\\.app$";
const fields = ["version", "projectId", "teamId", "stableHost", "supabaseProjectRef", "sourceHead", "baselineDigest"].sort();
const fail = message => { throw new Error("Admin release: " + message); };

export function validateAdminReleaseTarget(contract, { actualHead, baselineDigest }) {
  if (!contract || JSON.stringify(Object.keys(contract).sort()) !== JSON.stringify(fields) || contract.version !== 1) fail("target contract shape");
  if (!/^prj_[A-Za-z0-9]+$/.test(contract.projectId) || contract.projectId === POS_PROJECT_ID) fail("independent project required");
  if (contract.projectId !== BOOTSTRAP_PROJECT_ID) fail("authorized administration project required");
  if (contract.teamId !== AUTHORIZED_TEAM_ID) fail("team mismatch");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/.test(contract.stableHost) || /^vendifyseller(?:-|\.)/.test(contract.stableHost)) fail("dedicated stable hostname required");
  if (contract.stableHost !== BOOTSTRAP_STABLE_HOST) fail("authorized administration hostname required");
  if (contract.supabaseProjectRef !== PRODUCTION_REF) fail("production backend mismatch");
  if (!/^[a-f0-9]{40}$/.test(contract.sourceHead) || contract.sourceHead !== actualHead) fail("source HEAD mismatch");
  if (!/^[a-f0-9]{64}$/.test(contract.baselineDigest) || contract.baselineDigest !== baselineDigest) fail("baseline digest mismatch");
  return contract;
}

// Reuse the already-reviewed header conversion and exact path allowlist; omit
// every POS route and provide no filesystem fallback on any hostname.
export function getAdminReleaseRoutes(baselineConfig, stableHost, adminPaths) {
  return getAdminRoutes(baselineConfig, stableHost, ["index.html"], adminPaths)
    .filter(route => !route.missing);
}

export function validateAdminBootstrapTarget(contract, identity) {
  validateAdminReleaseTarget(contract, identity);
  if (contract.projectId !== BOOTSTRAP_PROJECT_ID || contract.stableHost !== BOOTSTRAP_STABLE_HOST) fail("bootstrap requires the exact new project and hostname");
  return contract;
}

export function getAdminBootstrapRoutes(baselineConfig, targetContract, adminPaths) {
  if (targetContract.projectId !== BOOTSTRAP_PROJECT_ID || targetContract.teamId !== AUTHORIZED_TEAM_ID || targetContract.stableHost !== BOOTSTRAP_STABLE_HOST) fail("bootstrap routing requires the exact new project, team and hostname");
  const stableRoutes = getAdminReleaseRoutes(baselineConfig, targetContract.stableHost, adminPaths);
  const generatedHostRoutes = stableRoutes.filter(route => route.has).map(route => {
    if (route.has.length !== 1 || route.has[0].type !== "host" || route.has[0].value !== targetContract.stableHost) fail("unexpected bootstrap host condition");
    return { ...route, has: [{ type: "host", value: { re: BOOTSTRAP_HOST_PATTERN } }] };
  });
  return [...stableRoutes.slice(0, -1), ...generatedHostRoutes, stableRoutes.at(-1)];
}

export function verifyAdminReleaseOutput({ output, artifact, config }) {
  const expected = Object.fromEntries(Object.entries(inventory(resolve(artifact, "admin"))).map(([path, digest]) => ["admin/" + path, digest]));
  const actual = inventory(resolve(output, "static"));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("admin-only static inventory mismatch");
  if (JSON.stringify(JSON.parse(readFileSync(resolve(output, "config.json"), "utf8"))) !== JSON.stringify(config)) fail("routing configuration mismatch");
  if (JSON.stringify(Object.keys(inventory(output)).sort()) !== JSON.stringify(["config.json", ...Object.keys(expected).map(path => "static/" + path)].sort())) fail("unexpected output files");
  return { files: actual, config };
}

export function packageAdminRelease({ root, targetContract, expectedHead, bootstrap = false }) {
  // Preparation is local-only. This entry point never submits deployments and
  // cannot silently become a Vercel Production build.
  if (process.env.VERCEL || process.env.VERCEL_ENV) fail("local preparation only; deployment requires separate authorization");
  const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (expectedHead !== actualHead) fail("expected HEAD mismatch");
  const baseline = resolve(root, "dist");
  const provenance = verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
  validateAdminReleaseTarget(targetContract, { actualHead, baselineDigest: provenance.digest });
  if (typeof bootstrap !== "boolean") fail("bootstrap mode must be explicit boolean");
  if (bootstrap) validateAdminBootstrapTarget(targetContract, { actualHead, baselineDigest: provenance.digest });
  const artifact = resolve(root, "dist-admin-release");
  const verified = verifyAdminEntry({ baseline, target: artifact });
  if (verified.manifest.baselineDigest !== provenance.digest) fail("admin baseline provenance mismatch");
  const adminPaths = Object.keys(inventory(resolve(artifact, "admin"))).map(path => "admin/" + path);
  for (const path of adminPaths) {
    const content = readFileSync(resolve(artifact, path), "utf8");
    for (const match of content.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
      let claims;
      try { claims = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url")); } catch { fail("undecodable JWT in artifact"); }
      if (path !== "admin/public-config.js" || claims.role !== "anon" || claims.ref !== PRODUCTION_REF) fail("private or unexpected JWT in artifact");
    }
  }
  const baselineConfig = JSON.parse(readFileSync(resolve(baseline, "vercel.json"), "utf8"));
  const config = { version: 3, routes: bootstrap ? getAdminBootstrapRoutes(baselineConfig, targetContract, adminPaths) : getAdminReleaseRoutes(baselineConfig, targetContract.stableHost, adminPaths) };
  const output = resolve(root, ".vendify-build/admin-release-output");
  rmSync(output, { recursive: true, force: true });
  mkdirSync(resolve(output, "static"), { recursive: true });
  cpSync(resolve(artifact, "admin"), resolve(output, "static/admin"), { recursive: true });
  writeFileSync(resolve(output, "config.json"), JSON.stringify(config, null, 2) + "\n");
  const result = verifyAdminReleaseOutput({ output, artifact, config });
  // Reverify original artifact after composition; no verifier is relaxed.
  verifyProductionReleaseArtifact({ root, target: baseline, contract: loadProductionReleaseContract(root) });
  const receipt = { version: 1, targetContract, sourceHead: actualHead, files: result.files, outputFiles: inventory(output), operation: "LOCAL_PREPARATION_ONLY", deploymentAuthorized: false };
  if (bootstrap) {
    receipt.operation = "LOCAL_BOOTSTRAP_PREPARATION_ONLY";
    receipt.bootstrap = { projectId: BOOTSTRAP_PROJECT_ID, hostPattern: BOOTSTRAP_HOST_PATTERN, generatedHostnameFormat: "EXPECTED_NOT_REMOTELY_VERIFIED", domainActivation: "NONE" };
  }
  writeFileSync(resolve(root, ".vendify-build/admin-release-manifest.json"), JSON.stringify(receipt, null, 2) + "\n");
  return { output, ...receipt };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.length !== 5 || !["--prepare", "--prepare-bootstrap"].includes(process.argv[2]) || process.argv[3] !== "--source-head" || !/^[a-f0-9]{40}$/.test(process.argv[4])) fail("use --prepare or --prepare-bootstrap --source-head <exact SHA>; no deployment operation exists");
  const versionedTarget = JSON.parse(readFileSync(resolve(root, "contracts/admin-release-target.json"), "utf8"));
  if (Object.hasOwn(versionedTarget, "sourceHead")) fail("versioned target must not contain self-referential sourceHead");
  const targetContract = { ...versionedTarget, sourceHead: process.argv[4] };
  const result = packageAdminRelease({ root, targetContract, expectedHead: targetContract.sourceHead, bootstrap: process.argv[2] === "--prepare-bootstrap" });
  console.log(`PASS: local admin-only release prepared for ${targetContract.projectId} / ${targetContract.stableHost}; ${Object.keys(result.files).length} files; no deployment submitted`);
}
