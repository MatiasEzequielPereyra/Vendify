import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveBuildTarget, buildVercelTarget, POS_PROJECT_ID, ADMIN_PROJECT_ID, ADMIN_PREVIEW_BRANCH } from "../../scripts/build-vercel-target.mjs";

const preview = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: ADMIN_PREVIEW_BRANCH, VERCEL_PROJECT_ID: POS_PROJECT_ID };

test("POS is the default locally and on its known project including Production", () => {
  for (const env of [{}, { ...preview, VERCEL_ENV: "production" }, { ...preview, VERCEL_GIT_COMMIT_REF: "main" }]) assert.equal(resolveBuildTarget(env), "pos");
  assert.equal(resolveBuildTarget(preview), "admin-preview");
  assert.equal(resolveBuildTarget({ ...preview, VENDIFY_VERCEL_TARGET: "pos" }), "pos");
});

test("unknown or missing hosted project identity fails closed", () => {
  for (const env of [{ ...preview, VERCEL_PROJECT_ID: "prj_other" }, { ...preview, VERCEL_PROJECT_ID: "prj_E4ml6uYIVAH5wQ31WoQAvc5GD02p" }, { ...preview, VERCEL_PROJECT_ID: undefined }, { VERCEL: "1" }, { VERCEL_PROJECT_ID: "prj_other", VENDIFY_VERCEL_TARGET: "pos" }]) assert.throws(() => resolveBuildTarget(env), /project identity/);
});

test("independent project accepts only exact isolated Preview and cannot build POS or Production", () => {
  const isolated = { ...preview, VERCEL_PROJECT_ID: ADMIN_PROJECT_ID };
  assert.equal(resolveBuildTarget(isolated), "admin-isolated-preview");
  assert.equal(resolveBuildTarget({ ...isolated, VENDIFY_VERCEL_TARGET: "admin-isolated-preview" }), "admin-isolated-preview");
  for (const env of [{ ...isolated, VERCEL_ENV: "production" }, { ...isolated, VERCEL_GIT_COMMIT_REF: "main" }, { ...isolated, VENDIFY_VERCEL_TARGET: "pos" }]) assert.throws(() => resolveBuildTarget(env), /Production is blocked/);
  for (const env of [preview, { ...isolated, VERCEL_ENV: "production" }, { ...isolated, VERCEL_GIT_COMMIT_REF: "main" }]) assert.throws(() => resolveBuildTarget({ ...env, VENDIFY_VERCEL_TARGET: "admin-isolated-preview" }), /exact environment/);
});

test("explicit admin target requires every authorization dimension and rejects unknown targets", () => {
  assert.equal(resolveBuildTarget({ ...preview, VENDIFY_VERCEL_TARGET: "admin-preview" }), "admin-preview");
  for (const [key, value] of [["VERCEL_ENV", "production"], ["VERCEL_GIT_COMMIT_REF", "main"], ["VERCEL_PROJECT_ID", "prj_other"]]) assert.throws(() => resolveBuildTarget({ ...preview, VENDIFY_VERCEL_TARGET: "admin-preview", [key]: value }), /exact environment/);
  for (const requested of ["admin-production", "", "unknown"]) assert.throws(() => resolveBuildTarget({ ...preview, VENDIFY_VERCEL_TARGET: requested }), /Unknown/);
});

test("stale administrative Build Output is removed before baseline-only Production commands", () => {
  const root = mkdtempSync(resolve(tmpdir(), "vendify-build-target-"));
  try {
    mkdirSync(resolve(root, ".vercel/output/static/admin"), { recursive: true });
    writeFileSync(resolve(root, ".vercel/output/static/admin/index.html"), "stale private entry");
    const calls = [];
    const target = buildVercelTarget({ root, env: { ...preview, VERCEL_ENV: "production" }, run(args) {
      assert.equal(existsSync(resolve(root, ".vercel/output")), false);
      calls.push(args);
    } });
    assert.equal(target, "pos");
    assert.deepEqual(calls, [["scripts/prepare-vercel-release-baseline.mjs"], ["scripts/build-release.mjs"], ["scripts/verify-release.mjs", "dist"]]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("authorized Preview composes administration only after strict baseline verification", () => {
  const events = [];
  assert.equal(buildVercelTarget({ root: "/fixture", env: preview, remove() { events.push("clean"); }, run(args) { events.push(args); } }), "admin-preview");
  assert.deepEqual(events, ["clean", ["scripts/prepare-vercel-release-baseline.mjs"], ["scripts/build-release.mjs"], ["scripts/verify-release.mjs", "dist"], ["scripts/build-admin-entry.mjs"], ["scripts/verify-admin-entry.mjs"], ["scripts/package-admin-vercel.mjs", "--preview-branch", ADMIN_PREVIEW_BRANCH]]);
});

test("invalid target or failed baseline never reaches administrative packaging", () => {
  const events = [];
  assert.throws(() => buildVercelTarget({ root: "/fixture", env: { VENDIFY_VERCEL_TARGET: "admin-production" }, remove() { events.push("clean"); }, run() { events.push("run"); } }), /Unknown/);
  assert.deepEqual(events, ["clean"]);
  const calls = [];
  assert.throws(() => buildVercelTarget({ root: "/fixture", env: preview, remove() {}, run(args) { calls.push(args[0]); if (args[0] === "scripts/verify-release.mjs") throw new Error("baseline mismatch"); } }), /baseline mismatch/);
  assert.equal(calls.includes("scripts/build-admin-entry.mjs"), false);
});

test("isolated Preview uses only its independent packager after baseline and admin verification", () => {
  const calls = [];
  assert.equal(buildVercelTarget({ root: "/fixture", env: { ...preview, VERCEL_PROJECT_ID: ADMIN_PROJECT_ID }, remove() {}, run(args) { calls.push(args); } }), "admin-isolated-preview");
  assert.deepEqual(calls, [["scripts/prepare-vercel-release-baseline.mjs"], ["scripts/build-release.mjs"], ["scripts/verify-release.mjs", "dist"], ["scripts/build-admin-entry.mjs"], ["scripts/verify-admin-entry.mjs"], ["scripts/package-admin-isolated-preview.mjs"]]);
});
