import test from "node:test";
import assert from "node:assert/strict";
import { getAdminRoutes, resolvePreviewAdminHost } from "../../scripts/package-admin-vercel.mjs";

const host = "vendify-unique-123.vercel.app";
const baseline = { headers: [{ source: "/(.*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; worker-src 'self' blob:; frame-ancestors 'none';" }] }] };
function evaluate(path, hostname) {
  const headers = {};
  for (const route of getAdminRoutes(baseline, host, ["index.html", "sw.js", "app.js"], ["admin/index.html", "admin/assets/entry.js"])) {
    if (route.handle) return { status: "filesystem", headers };
    if (!new RegExp(route.src).test(path)) continue;
    if (route.has && !route.has.every(condition => hostname.toLowerCase() === condition.value)) continue;
    if (route.missing && route.missing.some(condition => hostname.toLowerCase() === condition.value)) continue;
    Object.assign(headers, route.headers);
    if (!route.continue) return { status: route.status ?? "rewrite", dest: route.dest, headers };
  }
  throw new Error("No route");
}
test("POS host keeps classic routes but denies every admin spelling without redirects", () => {
  for (const path of ["/admin", "/admin/", "/admin/assets/entry.js", "/ADMIN/", "/AdMiN/"]) {
    const result = evaluate(path, "pos.example.com");
    assert.equal(result.status, 404);
    assert.equal(result.dest, "/__vendify_admin_route_not_found__.html");
    assert.equal(result.headers.Location, undefined);
  }
  assert.equal(evaluate("/", "pos.example.com").status, "rewrite");
  assert.equal(evaluate("/sw.js", "pos.example.com").status, "rewrite");
});
test("unique admin host cannot serve POS or its root service worker", () => {
  assert.equal(evaluate("/", host).headers.Location, "/admin/");
  assert.equal(evaluate("/admin", host).status, 307);
  assert.equal(evaluate("/admin/", host).dest, "/admin/index.html");
  assert.equal(evaluate("/admin/assets/entry.js", host).status, "rewrite");
  for (const path of ["/sw.js", "/index.html", "/app.js", "/styles.css", "/supabase-config.js", "/ADMIN/", "/anything"]) assert.equal(evaluate(path, host).status, 404);
});
test("noncanonical and encoded paths cannot reach a global filesystem fallback", () => {
 for(const hostname of [host,"pos.example.com"])
  for(const path of ["/%61dmin/", "/admin%2Findex.html", "//admin/", "/foo/../admin/", "/admin/../sw.js", "/admin/assets/../index.html"])
   assert.equal(evaluate(path,hostname).status,404);
});

test("host identity is exact and inherited protections remain with stricter workers", () => {
  assert.equal(evaluate("/admin/", "evil-" + host).status, 404);
  assert.equal(evaluate("/admin/", host + ".evil.com").status, 404);
  const result = evaluate("/admin/", host.toUpperCase());
  assert.equal(result.headers["X-Frame-Options"], "DENY");
  assert.equal(result.headers["Cache-Control"], "no-store, max-age=0");
  assert.equal(result.headers["Content-Security-Policy"], baseline.headers[0].headers[1].value.replace("worker-src 'self' blob:;", "worker-src 'none';"));
  assert.throws(() => getAdminRoutes(baseline, "https://" + host), /hostname/);
  assert.throws(() => getAdminRoutes(baseline, "*.vercel.app"), /hostname/);
});
test("Preview-only identity refuses production, branch aliases and missing target binding", () => {
  const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/ven-admin-001b1-read-model", VERCEL_URL: host, VERCEL_BRANCH_URL: "branch.vercel.app", VERCEL_PROJECT_PRODUCTION_URL: "production.vercel.app" };
  assert.equal(resolvePreviewAdminHost(env, env.VERCEL_GIT_COMMIT_REF), host);
  assert.throws(() => resolvePreviewAdminHost({ ...env, VERCEL_ENV: "production" }, env.VERCEL_GIT_COMMIT_REF), /Preview/);
  assert.throws(() => resolvePreviewAdminHost({ ...env, VERCEL_URL: env.VERCEL_BRANCH_URL }, env.VERCEL_GIT_COMMIT_REF), /unique/);
  assert.throws(() => resolvePreviewAdminHost({ ...env, VERCEL_URL: env.VERCEL_PROJECT_PRODUCTION_URL }, env.VERCEL_GIT_COMMIT_REF), /unique/);
  assert.throws(() => resolvePreviewAdminHost(env, "other-branch"), /Preview/);
});
