import test from "node:test";
import assert from "node:assert/strict";
import { resolveIsolatedPreviewTarget, isolatedPreviewRoutes } from "../../scripts/package-admin-isolated-preview.mjs";
const head = "a".repeat(40);
const contract = { projectId: "prj_IndependentAdmin", stableHost: "admin-release.vercel.app" };
const env = { VERCEL_ENV: "preview", VERCEL_PROJECT_ID: contract.projectId, VERCEL_GIT_COMMIT_REF: "feature/ven-admin-001b1-read-model", VERCEL_GIT_COMMIT_SHA: head, VERCEL_URL: "admin-unique.vercel.app", VERCEL_BRANCH_URL: "admin-branch.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "admin-old.vercel.app" };
test("independent Preview requires its exact project, branch, commit and fresh hostname", () => {
  assert.equal(resolveIsolatedPreviewTarget(env, contract, head), env.VERCEL_URL);
  for (const mutation of [{ VERCEL_ENV: "production" }, { VERCEL_PROJECT_ID: "prj_POS" }, { VERCEL_GIT_COMMIT_REF: "main" }, { VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }, { VERCEL_URL: env.VERCEL_BRANCH_URL }, { VERCEL_URL: env.VERCEL_PROJECT_PRODUCTION_URL }, { VERCEL_URL: contract.stableHost }, { VERCEL_URL: "admin.vercel.app.evil.com" }]) assert.throws(() => resolveIsolatedPreviewTarget({ ...env, ...mutation }, contract, head));
});
test("independent Preview and future stable origin have identical allowlists with no POS fallback", () => {
  const config = { headers: [{ source: "/(.*)", headers: [{ key: "Content-Security-Policy", value: "default-src 'self'; worker-src 'self';" }] }] };
  const routes = isolatedPreviewRoutes(config, contract, env.VERCEL_URL, ["admin/index.html", "admin/public-config.js"]);
  const terminal = (path, host) => routes.find(r => new RegExp(r.src).test(path) && (!r.has || r.has.every(h => h.value === host)) && !r.continue);
  for (const host of [env.VERCEL_URL, contract.stableHost]) {
    assert.equal(terminal("/admin/", host).dest, "/admin/index.html");
    for (const path of ["/sw.js", "/index.html", "/admin/sw.js", "/arbitrary.js"]) assert.equal(terminal(path, host).status, 404);
  }
  assert.equal(terminal("/admin/", "pos.vercel.app").status, 404);
  assert.ok(routes.every(r => !r.missing && !r.handle));
});
