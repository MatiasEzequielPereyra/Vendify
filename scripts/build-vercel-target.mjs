import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POS_PROJECT_ID = "prj_xYZevIAo7SwzsoUU1FV5hbGQEJXZ";
export const ADMIN_PROJECT_ID = "prj_E4ml6uYIVAH5wQ31WoQAvc5GD02p";
export const ADMIN_PREVIEW_BRANCH = "feature/ven-admin-001b1-read-model";

export function resolveBuildTarget(env) {
  const requested = env.VENDIFY_VERCEL_TARGET;
  if (requested !== undefined && !["pos", "admin-preview", "admin-isolated-preview"].includes(requested)) throw new Error("Unknown VENDIFY_VERCEL_TARGET; Production administration is not authorized");
  const authorizedPreview = env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === ADMIN_PREVIEW_BRANCH && env.VERCEL_PROJECT_ID === POS_PROJECT_ID;
  const isolatedPreview = env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === ADMIN_PREVIEW_BRANCH && env.VERCEL_PROJECT_ID === ADMIN_PROJECT_ID;
  if (requested === "admin-preview" && !authorizedPreview) throw new Error("Admin Preview target requires the exact environment, branch and project");
  if (requested === "admin-isolated-preview" && !isolatedPreview) throw new Error("Isolated Admin Preview target requires the exact environment, branch and project");
  if (env.VERCEL_PROJECT_ID === ADMIN_PROJECT_ID) {
    if (!isolatedPreview || requested === "pos") throw new Error("Independent administration project accepts only the authorized isolated Preview; Production is blocked");
    return "admin-isolated-preview";
  }
  if ((env.VERCEL || env.VERCEL_ENV || env.VERCEL_PROJECT_ID) && env.VERCEL_PROJECT_ID !== POS_PROJECT_ID) throw new Error("Unknown or missing Vercel project identity");
  return requested === "pos" ? "pos" : authorizedPreview ? "admin-preview" : "pos";
}

export function buildVercelTarget({ root, env = process.env, remove = rmSync, run = runNode }) {
  // Remove a previous Build Output API artifact even when target validation fails.
  // Otherwise Vercel could prefer stale administrative output over the POS dist.
  remove(resolve(root, ".vercel/output"), { recursive: true, force: true });
  const target = resolveBuildTarget(env);
  const commands = [
    ["scripts/prepare-vercel-release-baseline.mjs"],
    ["scripts/build-release.mjs"],
    ["scripts/verify-release.mjs", "dist"]
  ];
  if (target !== "pos") commands.push(
    ["scripts/build-admin-entry.mjs"],
    ["scripts/verify-admin-entry.mjs"],
    target === "admin-isolated-preview" ? ["scripts/package-admin-isolated-preview.mjs"] : ["scripts/package-admin-vercel.mjs", "--preview-branch", ADMIN_PREVIEW_BRANCH]
  );
  for (const args of commands) run(args, { root, env });
  return target;
}

function runNode(args, { root, env }) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build step failed: ${args[0]} (exit ${result.status}, signal ${result.signal ?? "none"})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  console.log(`PASS: Vercel target ${buildVercelTarget({ root })}`);
}
